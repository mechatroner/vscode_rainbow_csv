const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

const csv_utils = require('./rbql_core/rbql-js/csv_utils.js');
const rbql_csv = require('./rbql_core/rbql-js/rbql_csv.js');

var dialect_map = {
    'csv': [',', 'quoted'],
    'tsv': ['\t', 'simple'],
    'csv (semicolon)': [';', 'quoted'],
    'csv (pipe)': ['|', 'simple'],
    'csv (tilde)': ['~', 'simple'],
    'csv (caret)': ['^', 'simple'],
    'csv (colon)': [':', 'simple'],
    'csv (double quote)': ['"', 'simple'],
    'csv (equals)': ['=', 'simple'],
    'csv (dot)': ['.', 'simple'],
    'csv (whitespace)': [' ', 'whitespace'],
    'csv (hyphen)': ['-', 'simple']
};

// TODO implement skip header option in RBQL? - Should also update preview table.

// TODO Improve RBQL encoding handling logic when VScode encoding info API is implemented, see https://github.com/microsoft/vscode/issues/824

// TODO built-in RBQL docs with md -> html convertion

// TODO allow RBQL to run on non-file VSCode buffers: just copy the buffer content to a fixed tmp file, e.g. /tmp/vscode_rbql_mirror_buf.txt

// TODO autodetect rainbow content on copy in a new empty buffer.


var lint_results = new Map();
var aligned_files = new Set();
var autodetection_stoplist = new Set();
var original_language_ids = new Map();
var result_set_parent_map = new Map();

var lint_status_bar_button = null;
var rbql_status_bar_button = null;
var align_shrink_button = null;
var rainbow_off_status_bar_button = null;
var copy_back_button = null;

let last_statusbar_doc = null;

const preview_window_size = 12;

var rbql_context = null;

var last_rbql_queries = new Map();

var client_js_template_path = null;
var client_html_template_path = null;
var mock_script_path = null;
var rbql_exec_path = null;

var client_js_template = null;
var client_html_template = null;

var global_state = null;

var preview_panel = null;

const enable_dev_mode = false;


function map_separator_to_language_id(separator) {
    for (let language_id in dialect_map) {
        if (!dialect_map.hasOwnProperty(language_id))
            continue;
        if (dialect_map[language_id][0] == separator)
            return language_id;
    }
    return null;
}


function sample_preview_records_from_context(rbql_context) {
    var document = rbql_context.document;
    var total_lines = document.lineCount;
    var line_begin = rbql_context.line;
    var delim = rbql_context.delim;
    var policy = rbql_context.policy;

    var preview_records = [];
    var max_cols = 0;
    var line_end = Math.min(total_lines, line_begin + preview_window_size);
    for (var nr = line_begin; nr < line_end; nr++) {
        var line_text = document.lineAt(nr).text;
        if (nr + 1 >= total_lines && total_lines > 1 && line_text == '')
            break;
        var cur_record = csv_utils.smart_split(line_text, delim, policy, false)[0];
        max_cols = Math.max(max_cols, cur_record.length);
        cur_record.splice(0, 0, nr + 1);
        preview_records.push(cur_record);
    }
    var header_record = ['NR'];
    for (var i = 0; i < max_cols; i++) {
        header_record.push('a' + (i + 1));
    }
    preview_records.splice(0, 0, header_record);
    return preview_records;
}


function get_header_line(document) {
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix = config ? config.get('comment_prefix') : '';
    const num_lines = document.lineCount;
    for (let lnum = 0; lnum < num_lines; ++lnum) {
        const line_text = document.lineAt(lnum).text;
        if (!comment_prefix || !line_text.startsWith(comment_prefix)) {
            return line_text;
        }
    }
    return null;
}


function get_header(document, delim, policy) {
    var file_path = document.fileName;
    if (file_path && global_state) {
        var header = global_state.get(file_path);
        if (header) {
            return csv_utils.smart_split(header, ',', 'quoted', false)[0];
        }
    }
    return csv_utils.smart_split(get_header_line(document), delim, policy, false)[0];
}


function get_field_by_line_position(fields, query_pos) {
    if (!fields.length)
        return null;
    var col_num = 0;
    var cpos = fields[col_num].length + 1;
    while (query_pos > cpos && col_num + 1 < fields.length) {
        col_num += 1;
        cpos = cpos + fields[col_num].length + 1;
    }
    return col_num;
}


function make_hover_text(document, position, language_id, enable_tooltip_column_names, enable_tooltip_warnings) {
    let [delim, policy] = dialect_map[language_id];
    var lnum = position.line;
    var cnum = position.character;
    var line = document.lineAt(lnum).text;

    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix = config ? config.get('comment_prefix') : '';
    if (comment_prefix && line.startsWith(comment_prefix))
        return 'Comment';

    var report = csv_utils.smart_split(line, delim, policy, true);

    var entries = report[0];
    var warning = report[1];
    var col_num = get_field_by_line_position(entries, cnum + 1);

    if (col_num == null)
        return null;
    var result = 'Col #' + (col_num + 1);

    var header = get_header(document, delim, policy);
    if (enable_tooltip_column_names && col_num < header.length) {
        const max_label_len = 50;
        let column_label = header[col_num].trim();
        var short_column_label = column_label.substr(0, max_label_len);
        if (short_column_label != column_label)
            short_column_label = short_column_label + '...';
        result += ', Header: "' + short_column_label + '"';
    }
    if (enable_tooltip_warnings && header.length != entries.length)
        result += "; WARN: num of fields in Header and this line differs";
    if (enable_tooltip_warnings && warning)
        result += '; This line has quoting error';
    return result;
}


function make_hover(document, position, language_id, cancellation_token) {
    if (last_statusbar_doc != document) {
        refresh_status_bar_buttons(document); // Being paranoid and making shure that the buttons are visible
    }
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    if (!config)
        return;
    if (!config.get('enable_tooltip'))
        return;
    let enable_tooltip_column_names = config.get('enable_tooltip_column_names');
    let enable_tooltip_warnings = config.get('enable_tooltip_warnings');
    var hover_text = make_hover_text(document, position, language_id, enable_tooltip_column_names, enable_tooltip_warnings);
    if (hover_text && !cancellation_token.isCancellationRequested) {
        return new vscode.Hover(hover_text);
    } else {
        return null;
    }
}


function produce_lint_report(active_doc, delim, policy, config) {
    let comment_prefix = config.get('comment_prefix');
    let detect_trailing_spaces = config.get('csv_lint_detect_trailing_spaces');
    let first_trailing_space_line = null;
    var num_lines = active_doc.lineCount;
    var num_fields = null;
    for (var lnum = 0; lnum < num_lines; lnum++) {
        var line_text = active_doc.lineAt(lnum).text;
        if (lnum + 1 == num_lines && !line_text)
            break;
        if (comment_prefix && line_text.startsWith(comment_prefix))
            continue;
        var split_result = csv_utils.smart_split(line_text, delim, policy, true);
        if (split_result[1]) {
            return 'Error. Line ' + (lnum + 1) + ' has formatting error: double quote chars are not consistent';
        }
        if (detect_trailing_spaces && first_trailing_space_line === null) {
            let fields = split_result[0];
            for (let i = 0; i < fields.length; i++) {
                if (fields[i].length && (fields[i].charAt(0) == ' ' || fields[i].slice(-1) == ' ')) {
                    first_trailing_space_line = lnum;
                }
            }
        }
        if (!num_fields) {
            num_fields = split_result[0].length;
        }
        if (num_fields != split_result[0].length) {
            return 'Error. Number of fields is not consistent: e.g. line 1 has ' + num_fields + ' fields, and line ' + (lnum + 1) + ' has ' + split_result[0].length + ' fields.';
        }
    }
    if (first_trailing_space_line !== null) {
        return 'Leading/Trailing spaces detected: e.g. at line ' + (first_trailing_space_line + 1) + '. Run "Shrink" command to remove them.';
    }
    return 'OK';
}


function calc_column_sizes(active_doc, delim, policy) {
    let result = [];
    let num_lines = active_doc.lineCount;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix = config ? config.get('comment_prefix') : '';
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (comment_prefix && line_text.startsWith(comment_prefix))
            continue;
        let [fields, warning] = csv_utils.smart_split(line_text, delim, policy, true);
        if (warning) {
            return [null, lnum + 1];
        }
        for (let i = 0; i < fields.length; i++) {
            if (result.length <= i)
                result.push(0);
            result[i] = Math.max(result[i], (fields[i].trim()).length);
        }
    }
    return [result, null];
}


function shrink_columns(active_doc, delim, policy) {
    let result_lines = [];
    let num_lines = active_doc.lineCount;
    let has_edit = false;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix = config ? config.get('comment_prefix') : '';
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (comment_prefix && line_text.startsWith(comment_prefix)) {
            result_lines.push(line_text);
            continue;
        }
        let [fields, warning] = csv_utils.smart_split(line_text, delim, policy, true);
        if (warning) {
            return [null, lnum + 1];
        }
        for (let i = 0; i < fields.length; i++) {
            let adjusted = fields[i].trim();
            if (fields[i].length != adjusted.length) {
                fields[i] = adjusted;
                has_edit = true;
            }
        }
        result_lines.push(fields.join(delim));
    }
    if (!has_edit)
        return [null, null];
    return [result_lines.join('\n'), null];
}


function align_columns(active_doc, delim, policy, column_sizes) {
    let result_lines = [];
    let num_lines = active_doc.lineCount;
    let has_edit = false;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix = config ? config.get('comment_prefix') : '';
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (comment_prefix && line_text.startsWith(comment_prefix)) {
            result_lines.push(line_text);
            continue;
        }
        let fields = csv_utils.smart_split(line_text, delim, policy, true)[0];
        for (let i = 0; i < fields.length - 1; i++) {
            if (i >= column_sizes.length) // Safeguard against async doc edit
                break;
            let adjusted = fields[i].trim();
            let delta_len = column_sizes[i] - adjusted.length;
            if (delta_len >= 0) { // Safeguard against async doc edit
                adjusted += ' '.repeat(delta_len + 1);
            }
            if (fields[i] != adjusted) {
                fields[i] = adjusted;
                has_edit = true;
            }
        }
        result_lines.push(fields.join(delim));
    }
    if (!has_edit)
        return null;
    return result_lines.join('\n');
}


function get_active_editor() {
    var active_window = vscode.window;
    if (!active_window)
        return null;
    var active_editor = active_window.activeTextEditor;
    if (!active_editor)
        return null;
    return active_editor;
}


function get_active_doc(active_editor=null) {
    if (!active_editor)
        active_editor = get_active_editor();
    if (!active_editor)
        return null;
    var active_doc = active_editor.document;
    if (!active_doc)
        return null;
    return active_doc;
}


function show_lint_status_bar_button(file_path, language_id) {
    let lint_cache_key = `${file_path}.${language_id}`;
    if (!lint_results.has(lint_cache_key))
        return;
    var lint_report = lint_results.get(lint_cache_key);
    if (!lint_status_bar_button)
        lint_status_bar_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    lint_status_bar_button.text = 'CSVLint';
    if (lint_report === 'OK') {
        lint_status_bar_button.color = '#62f442';
    } else if (lint_report == 'Processing...') {
        lint_status_bar_button.color = '#A0A0A0';
    } else if (lint_report.indexOf('spaces detected') != -1) {
        lint_status_bar_button.color = '#ffff28';
    } else {
        lint_status_bar_button.color = '#f44242';
    }
    lint_status_bar_button.tooltip = lint_report + '\nClick to recheck';
    lint_status_bar_button.command = 'extension.CSVLint';
    lint_status_bar_button.show();
}


function show_align_shrink_button(file_path) {
    if (!align_shrink_button)
        align_shrink_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    if (aligned_files.has(file_path)) {
        align_shrink_button.text = 'Shrink';
        align_shrink_button.tooltip = 'Click to shrink table (Then you can click again to align)';
        align_shrink_button.command = 'extension.Shrink';
    } else {
        align_shrink_button.text = 'Align';
        align_shrink_button.tooltip = 'Click to align table (Then you can click again to shrink)';
        align_shrink_button.command = 'extension.Align';
    }
    align_shrink_button.show();
}


function show_rainbow_off_status_bar_button() {
    if (typeof vscode.languages.setTextDocumentLanguage == "undefined") {
        return;
    }
    if (!rainbow_off_status_bar_button)
        rainbow_off_status_bar_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    rainbow_off_status_bar_button.text = 'Rainbow OFF';
    rainbow_off_status_bar_button.tooltip = 'Click to restore original file type and syntax';
    rainbow_off_status_bar_button.command = 'extension.RainbowSeparatorOff';
    rainbow_off_status_bar_button.show();
}


function show_rbql_status_bar_button() {
    if (!rbql_status_bar_button)
        rbql_status_bar_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    rbql_status_bar_button.text = 'RBQL';
    rbql_status_bar_button.tooltip = 'Click to run SQL-like RBQL query';
    rbql_status_bar_button.command = 'extension.RBQL';
    rbql_status_bar_button.show();
}


function hide_status_bar_buttons() {
    let all_buttons = [lint_status_bar_button, rbql_status_bar_button, rainbow_off_status_bar_button, copy_back_button, align_shrink_button];
    for (let i = 0; i < all_buttons.length; i++) {
        if (all_buttons[i])
            all_buttons[i].hide();
    }
}


function show_rbql_copy_to_source_button(file_path) {
    let parent_table_path = result_set_parent_map.get(file_path.toLowerCase());
    if (!parent_table_path)
        return;
    let parent_basename = path.basename(parent_table_path);
    if (!copy_back_button)
        copy_back_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    copy_back_button.text = 'Copy Back';
    copy_back_button.tooltip = `Copy to parent table: ${parent_basename}`;
    copy_back_button.command = 'extension.CopyBack';
    copy_back_button.show();
}


function refresh_status_bar_buttons(active_doc=null) {
    if (!active_doc)
        active_doc = get_active_doc();
    last_statusbar_doc = active_doc;
    var file_path = active_doc ? active_doc.fileName : null;
    if (!active_doc || !file_path) {
        hide_status_bar_buttons();
        return;
    }
    if (file_path.endsWith('.git')) {
        return; // Sometimes for git-controlled dirs VSCode opens mysterious .git files. Skip them, don't hide buttons
    }
    hide_status_bar_buttons();
    var language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    show_lint_status_bar_button(file_path, language_id);
    show_rbql_status_bar_button();
    show_align_shrink_button(file_path);
    show_rainbow_off_status_bar_button();
    show_rbql_copy_to_source_button(file_path);
}


function csv_lint(active_doc, is_manual_op) {
    if (!active_doc)
        active_doc = get_active_doc();
    if (!active_doc)
        return false;
    var file_path = active_doc.fileName;
    if (!file_path)
        return false;
    var language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return false;
    let lint_cache_key = `${file_path}.${language_id}`;
    if (!is_manual_op) {
        if (lint_results.has(lint_cache_key))
            return false;
        const config = vscode.workspace.getConfiguration('rainbow_csv');
        if (config && config.get('enable_auto_csv_lint') === false)
            return false;
    }
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    if (!config)
        return false;
    lint_results.set(lint_cache_key, 'Processing...');
    refresh_status_bar_buttons(active_doc); // Visual feedback
    let [delim, policy] = dialect_map[language_id];
    var lint_report = produce_lint_report(active_doc, delim, policy, config);
    lint_results.set(lint_cache_key, lint_report);
    return true;
}


function csv_lint_cmd() {
    // TODO re-run on each file save with content change
    csv_lint(null, true);
    // Need timeout here to give user enough time to notice green -> yellow -> green switch, this is a sort of visual feedback
    setTimeout(refresh_status_bar_buttons, 500);
}


function show_warnings(warnings) {
    // VSCode warnings are single-line, so this works only because all current RBQL warnings are also single-line.
    if (!warnings || !warnings.length)
        return;
    var active_window = vscode.window;
    if (!active_window)
        return null;
    active_window.showWarningMessage('RBQL query completed with warnings!');
    for (var i = 0; i < warnings.length; i++) {
        active_window.showWarningMessage(warnings[i]);
    }
}


function show_single_line_error(error_msg) {
    var active_window = vscode.window;
    if (!active_window)
        return;
    active_window.showErrorMessage(error_msg);
}


function try_change_document_language(active_doc, language_id, is_manual_op, callback_func) {
    try {
        vscode.languages.setTextDocumentLanguage(active_doc, language_id).then((doc) => {
            if (callback_func !== null)
                callback_func(doc);
        });
    } catch (error) {
        if (is_manual_op)
            show_single_line_error("Unable to proceed. Minimal VSCode version required: 1.28");
        return false;
    }
    return true;
}


function handle_rbql_result_file(text_doc, warnings) {
    var out_delim = rbql_context.output_delim;
    let language_id = map_separator_to_language_id(out_delim);
    var active_window = vscode.window;
    if (!active_window)
        return;
    var handle_success = function(_editor) {
        if (language_id && text_doc.language_id != language_id) {
            console.log('changing RBQL result language ' + text_doc.language_id + ' -> ' + language_id);
            try_change_document_language(text_doc, language_id, false, null);
        }
        show_warnings(warnings);
    };
    var handle_failure = function(_reason) { show_single_line_error('Unable to open document'); };
    active_window.showTextDocument(text_doc).then(handle_success, handle_failure);
}


function run_command(cmd, args, close_and_error_guard, callback_func) {
    var command = child_process.spawn(cmd, args, {'windowsHide': true});
    var stdout = '';
    var stderr = '';
    command.stdout.on('data', function(data) {
        stdout += data.toString();
    });
    command.stderr.on('data', function(data) {
        stderr += data.toString();
    });
    command.on('close', function(code) {
        if (!close_and_error_guard['process_reported']) {
            close_and_error_guard['process_reported'] = true;
            callback_func(code, stdout, stderr);
        }
    });
    command.on('error', function(error) {
        var error_msg = error ? error.name + ': ' + error.message : '';
        if (!close_and_error_guard['process_reported']) {
            close_and_error_guard['process_reported'] = true;
            callback_func(1, '', 'Something went wrong. Make sure you have python installed and added to PATH variable in your OS. Or you can use it with JavaScript instead - it should work out of the box\nDetails:\n' + error_msg);
        }
    });
}


function handle_command_result(src_table_path, dst_table_path, error_code, stdout, stderr, webview_report_handler) {
    let json_report = stdout;
    let error_type = null;
    let error_msg = null;
    let warnings = [];
    if (error_code || !json_report || stderr) {
        error_type = 'Integration';
        error_msg = stderr ? stderr : 'empty error';
    } else {
        try {
            let report = JSON.parse(json_report);
            if (report.hasOwnProperty('error_type'))
                error_type = report['error_type'];
            if (report.hasOwnProperty('error_msg'))
                error_msg = report['error_msg'];
            if (report.hasOwnProperty('warnings'))
                warnings = report['warnings'];
        } catch (e) {
            error_type = 'Integration';
            error_msg = 'Unable to parse JSON report';
        }
    }
    webview_report_handler(error_type, error_msg);
    if (error_type || error_msg) {
        return; // Just exit: error would be shown in the preview window.
    }
    autodetection_stoplist.add(dst_table_path);
    result_set_parent_map.set(dst_table_path.toLowerCase(), src_table_path);
    vscode.workspace.openTextDocument(dst_table_path).then(doc => handle_rbql_result_file(doc, warnings));
}



function get_last_start_line(document) {
    var num_lines = document.lineCount;
    var skip_last = 0;
    if (num_lines > 1 && document.lineAt(num_lines - 1).text == '') {
        skip_last = 1;
    }
    return Math.max(0, rbql_context.document.lineCount - preview_window_size - skip_last);
}


function get_dst_table_name(input_path, output_delim) {
    var table_name = path.basename(input_path);
    var orig_extension = path.extname(table_name);
    var delim_ext_map = {'\t': '.tsv', ',': '.csv'};
    var dst_extension = '.txt';
    if (delim_ext_map.hasOwnProperty(output_delim)) {
        dst_extension = delim_ext_map[output_delim];
    } else if (orig_extension.length > 1) {
        dst_extension = orig_extension;
    }
    return table_name + dst_extension;
}


function handle_worker_success(output_path, warnings, webview_report_handler) {
    webview_report_handler(null, null);
    autodetection_stoplist.add(output_path);
    vscode.workspace.openTextDocument(output_path).then(doc => handle_rbql_result_file(doc, warnings));
}


function run_rbql_query(input_path, csv_encoding, backend_language, rbql_query, output_dialect, webview_report_handler) {
    last_rbql_queries.set(input_path, {'query': rbql_query});
    var cmd = 'python';
    const test_marker = 'test ';
    let close_and_error_guard = {'process_reported': false};

    let [output_delim, output_policy] = [rbql_context.delim, rbql_context.policy];
    if (output_dialect == 'csv')
        [output_delim, output_policy] = [',', 'quoted'];
    if (output_dialect == 'tsv')
        [output_delim, output_policy] = ['\t', 'simple'];
    rbql_context.output_delim = output_delim;

    let tmp_dir = os.tmpdir();
    let output_file_name = get_dst_table_name(input_path, output_delim);
    let output_path = path.join(tmp_dir, output_file_name);

    if (rbql_query.startsWith(test_marker)) {
        if (rbql_query.indexOf('nopython') != -1) {
            cmd = 'nopython';
        }
        let args = [mock_script_path, rbql_query];
        run_command(cmd, args, close_and_error_guard, function(error_code, stdout, stderr) { handle_command_result(input_path, output_path, error_code, stdout, stderr, webview_report_handler); });
        return;
    }
    if (backend_language == 'js') {
        var handle_success = function(warnings) {
            result_set_parent_map.set(output_path.toLowerCase(), input_path);
            handle_worker_success(output_path, warnings, webview_report_handler);
        };
        rbql_csv.csv_run(rbql_query, input_path, rbql_context.delim, rbql_context.policy, output_path, output_delim, output_policy, csv_encoding, handle_success, webview_report_handler);
    } else {
        let cmd_safe_query = Buffer.from(rbql_query, "utf-8").toString("base64");
        let args = [rbql_exec_path, cmd_safe_query, input_path, rbql_context.delim, rbql_context.policy, output_path, output_delim, output_policy, csv_encoding];
        run_command(cmd, args, close_and_error_guard, function(error_code, stdout, stderr) { handle_command_result(input_path, output_path, error_code, stdout, stderr, webview_report_handler); });
    }
}


function get_dialect(document) {
    var language_id = document.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return ['monocolumn', 'monocolumn'];
    return dialect_map[language_id];
}


function save_new_header(file_path, new_header) {
    global_state.update(file_path, new_header);
}


function set_rainbow_separator() {
    let active_editor = get_active_editor();
    if (!active_editor)
        return;
    var active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    let original_language_id = active_doc.languageId;
    let selection = active_editor.selection;
    if (!selection) {
        show_single_line_error("Selection is empty");
        return;
    }
    if (selection.start.line != selection.end.line || selection.start.character + 1 != selection.end.character) {
        show_single_line_error("Selection must contain exactly one separator character");
        return;
    }
    let separator = active_doc.lineAt(selection.start.line).text.charAt(selection.start.character);
    let language_id = map_separator_to_language_id(separator);
    if (!language_id) {
        show_single_line_error("Selected separator is not supported");
        return;
    }
    try_change_document_language(active_doc, language_id, true, (doc) => {
        original_language_ids.set(doc.fileName, original_language_id);
        csv_lint(doc, false);
        refresh_status_bar_buttons(doc);
    });
}


function restore_original_language() {
    var active_doc = get_active_doc();
    if (!active_doc)
        return;
    let file_path = active_doc.fileName;
    autodetection_stoplist.add(file_path);
    let original_language_id = 'plaintext';
    if (original_language_ids.has(file_path)) {
        original_language_id = original_language_ids.get(file_path);
    }
    if (!original_language_id || original_language_id == active_doc.languageId) {
        show_single_line_error("Unable to restore original language");
        return;
    }
    try_change_document_language(active_doc, original_language_id, true, (doc) => {
        original_language_ids.delete(file_path);
        refresh_status_bar_buttons(doc);
    });
}


function update_records(records, record_key, new_record) {
    for (var i = 0; i < records.length; i++) {
        if (records[i].length && records[i][0] == record_key) {
            records[i] = new_record;
            return;
        }
    }
    records.push(new_record);
}


function try_read_index(index_path) {
    var content = null;
    try {
        content = fs.readFileSync(index_path, 'utf-8');
    } catch (e) {
        return [];
    }
    var lines = content.split('\n');
    var records = [];
    for (var i = 0; i < lines.length; i++) {
        if (!lines[i])
            continue;
        var record = lines[i].split('\t');
        records.push(record);
    }
    return records;
}


function write_index(records, index_path) {
    var lines = [];
    for (var i = 0; i < records.length; i++) {
        lines.push(records[i].join('\t'));
    }
    fs.writeFileSync(index_path, lines.join('\n'));
}


function do_set_table_name(table_path, table_name) {
    // TODO use VSCode "globalState" persistent storage instead with new RBQL version
    let home_dir = os.homedir();
    let index_path = path.join(home_dir, '.rbql_table_names');
    let records = try_read_index(index_path);
    let new_record = [table_name, table_path];
    update_records(records, table_name, new_record);
    if (records.length > 100) {
        records.splice(0, 1);
    }
    write_index(records, index_path);
}


function set_join_table_name() {
    var active_doc = get_active_doc();
    if (!active_doc)
        return;
    let file_path = active_doc.fileName;
    if (!file_path)
        return;
    var title = "Input table name to use in RBQL JOIN expressions instead of table path";
    var input_box_props = {"prompt": title};
    vscode.window.showInputBox(input_box_props).then(table_name => do_set_table_name(file_path, table_name));
}


function edit_column_names() {
    var active_doc = get_active_doc();
    var dialect = get_dialect(active_doc);
    var delim = dialect[0];
    var policy = dialect[1];
    var file_path = active_doc.fileName;
    if (!file_path) {
        show_single_line_error('Unable to edit column names for non-file documents');
        return;
    }
    if (policy == 'monocolumn')
        return;
    var old_header = get_header(active_doc, delim, policy);
    var title = "Adjust column names displayed in hover tooltips. Actual header line and file content won't be affected.";
    var old_header_str = quoted_join(old_header, ',');
    var input_box_props = {"prompt": title, "value": old_header_str};
    var handle_success = function(new_header) { save_new_header(file_path, new_header); };
    var handle_failure = function(reason) { show_single_line_error('Unable to create input box: ' + reason); };
    vscode.window.showInputBox(input_box_props).then(handle_success, handle_failure);
}


function column_edit(edit_mode) {
    let active_editor = get_active_editor();
    if (!active_editor || !active_editor.selection)
        return;
    let active_doc = active_editor.document;
    if (!active_doc)
        return;
    let dialect = get_dialect(active_doc);
    let delim = dialect[0];
    let policy = dialect[1];
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    if (!config)
        return;
    let comment_prefix = config.get('comment_prefix');

    let position = active_editor.selection.active;
    let lnum = position.line;
    let cnum = position.character;
    let line = active_doc.lineAt(lnum).text;

    let report = csv_utils.smart_split(line, delim, policy, true);

    let entries = report[0];
    let quoting_warning = report[1];
    let col_num = get_field_by_line_position(entries, cnum + 1);

    let selections = [];
    let num_lines = active_doc.lineCount;
    if (num_lines >= 10000) {
        show_single_line_error('Multicursor column edit works only for files smaller than 10000 lines.');
        return;
    }
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (lnum + 1 == num_lines && !line_text)
            break;
        if (comment_prefix && line_text.startsWith(comment_prefix))
            continue;
        let report = csv_utils.smart_split(line_text, delim, policy, true);
        let entries = report[0];
        quoting_warning = quoting_warning || report[1];
        if (col_num >= entries.length) {
            show_single_line_error(`Line ${lnum + 1} doesn't have field number ${col_num + 1}`);
            return;
        }
        let char_pos_before = entries.slice(0, col_num).join('').length + col_num;
        let char_pos_after = entries.slice(0, col_num + 1).join('').length + col_num;
        if (edit_mode == 'ce_before' && policy == 'quoted' && line_text.substring(char_pos_before - 2, char_pos_before + 2).indexOf('"') != -1) {
            show_single_line_error(`Accidental data corruption prevention: Cursor at line ${lnum + 1} will not be set: a double quote is in proximity.`);
            return;
        }
        if (edit_mode == 'ce_after' && policy == 'quoted' && line_text.substring(char_pos_after - 2, char_pos_after + 2).indexOf('"') != -1) {
            show_single_line_error(`Accidental data corruption prevention: Cursor at line ${lnum + 1} will not be set: a double quote is in proximity.`);
            return;
        }
        if (edit_mode == 'ce_select' && char_pos_before == char_pos_after) {
            show_single_line_error(`Accidental data corruption prevention: The column can not be selected: field ${col_num + 1} at line ${lnum + 1} is empty.`);
            return;
        }
        let position_before = new vscode.Position(lnum, char_pos_before);
        let position_after = new vscode.Position(lnum, char_pos_after);
        if (edit_mode == 'ce_before') {
            selections.push(new vscode.Selection(position_before, position_before));
        }
        if (edit_mode == 'ce_after') {
            selections.push(new vscode.Selection(position_after, position_after));
        }
        if (edit_mode == 'ce_select') {
            selections.push(new vscode.Selection(position_before, position_after));
        }
    }
    active_editor.selections = selections;
    if (quoting_warning) {
        vscode.window.showWarningMessage('Some lines have quoting issues: cursors positioning may be incorrect.');
    }
}


function shrink_table(active_editor, edit_builder) {
    let active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    let language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    let [delim, policy] = dialect_map[language_id];
    let [shrinked_doc_text, first_failed_line] = shrink_columns(active_doc, delim, policy);
    if (first_failed_line) {
        show_single_line_error(`Unable to shrink: Inconsistent double quotes at line ${first_failed_line}`);
        return;
    }
    aligned_files.delete(active_doc.fileName);
    refresh_status_bar_buttons(active_doc);
    if (shrinked_doc_text === null) {
        vscode.window.showWarningMessage('No trailing whitespaces found, skipping');
        return;
    }
    let invalid_range = new vscode.Range(0, 0, active_doc.lineCount /* Intentionally missing the '-1' */, 0);
    let full_range = active_doc.validateRange(invalid_range);
    edit_builder.replace(full_range, shrinked_doc_text);
}


function align_table(active_editor, edit_builder) {
    let active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    let language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    let [delim, policy] = dialect_map[language_id];
    let [column_sizes, first_failed_line] = calc_column_sizes(active_doc, delim, policy);
    if (first_failed_line) {
        show_single_line_error(`Unable to allign: Inconsistent double quotes at line ${first_failed_line}`);
        return;
    }
    let aligned_doc_text = align_columns(active_doc, delim, policy, column_sizes);
    aligned_files.add(active_doc.fileName);
    refresh_status_bar_buttons(active_doc);
    if (aligned_doc_text === null) {
        vscode.window.showWarningMessage('Table is already aligned, skipping');
        return;
    }
    let invalid_range = new vscode.Range(0, 0, active_doc.lineCount /* Intentionally missing the '-1' */, 0);
    let full_range = active_doc.validateRange(invalid_range);
    edit_builder.replace(full_range, aligned_doc_text);
}


function do_copy_back(query_result_doc, active_editor) {
    let data = query_result_doc.getText();
    let active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    let invalid_range = new vscode.Range(0, 0, active_doc.lineCount /* Intentionally missing the '-1' */, 0);
    let full_range = active_doc.validateRange(invalid_range);
    active_editor.edit(edit => edit.replace(full_range, data));
}


function copy_back() {
    let result_doc = get_active_doc();
    if (!result_doc)
        return;
    let file_path = result_doc.fileName;
    let parent_table_path = result_set_parent_map.get(file_path.toLowerCase());
    if (!parent_table_path)
        return;
    vscode.workspace.openTextDocument(parent_table_path).then(doc => vscode.window.showTextDocument(doc).then(active_editor => do_copy_back(result_doc, active_editor)));
}


function get_from_global_state(key, default_value) {
    if (global_state) {
        var value = global_state.get(key);
        if (value)
            return value;
    }
    return default_value;
}


function handle_rbql_client_message(webview, message) {
    let message_type = message['msg_type'];

    if (message_type == 'handshake') {
        var active_file_path = rbql_context['document'].fileName;
        var backend_language = get_from_global_state('rbql_backend_language', 'js');
        var encoding = get_from_global_state('rbql_encoding', 'latin-1');
        var init_msg = {'msg_type': 'handshake', 'backend_language': backend_language, 'encoding': encoding};
        init_msg['window_records'] = sample_preview_records_from_context(rbql_context);
        if (last_rbql_queries.has(active_file_path)) {
            var last_query_info = last_rbql_queries.get(active_file_path);
            init_msg['last_query'] = last_query_info['query'];
        }
        webview.postMessage(init_msg);
    }

    if (message_type == 'navigate') {
        var navig_direction = message['direction'];
        var last_start_line = get_last_start_line(rbql_context.document);
        if (navig_direction == 'up') {
            rbql_context.line = Math.max(rbql_context.line - 1, 0);
        } else if (navig_direction == 'down') {
            rbql_context.line = Math.min(rbql_context.line + 1, last_start_line);
        } else if (navig_direction == 'begin') {
            rbql_context.line = 0;
        } else if (navig_direction == 'end') {
            rbql_context.line = last_start_line;
        }
        var window_records = sample_preview_records_from_context(rbql_context);
        webview.postMessage({'msg_type': 'navigate', 'window_records': window_records});
    }

    if (message_type == 'run') {
        let rbql_query = message['query'];
        let backend_language = message['backend_language'];
        let encoding = message['encoding'];
        let output_dialect = message['output_dialect'];
        var webview_report_handler = function(error_type, error_msg) {
            let report_msg = {'msg_type': 'rbql_report'};
            if (error_type)
                report_msg["error_type"] = error_type;
            if (error_msg)
                report_msg["error_msg"] = error_msg;
            webview.postMessage(report_msg);
        };
        var active_file_path = rbql_context['document'].fileName;
        run_rbql_query(active_file_path, encoding, backend_language, rbql_query, output_dialect, webview_report_handler);
    }

    if (message_type == 'global_param_change') {
        let param_key = message['key'];
        let param_value = message['value'];
        if (global_state) {
            global_state.update(param_key, param_value);
        }
    }
}


function edit_rbql() {
    let active_window = vscode.window;
    if (!active_window)
        return;
    let active_editor = active_window.activeTextEditor;
    if (!active_editor)
        return;
    let active_doc = active_editor.document;
    if (!active_doc)
        return;
    let orig_uri = active_doc.uri;
    if (!orig_uri || orig_uri.scheme != 'file' || active_doc.isDirty) {
        show_single_line_error("Unable to run RBQL: file has unsaved changes");
        return;
    }
    let language_id = active_doc.languageId;
    let delim = 'monocolumn';
    let policy = 'monocolumn';
    if (dialect_map.hasOwnProperty(language_id)) {
        [delim, policy] = dialect_map[language_id];
    }
    rbql_context = {"document": active_doc, "line": 0, "delim": delim, "policy": policy};

    preview_panel = vscode.window.createWebviewPanel('rbql-console', 'RBQL Console', vscode.ViewColumn.Active, {enableScripts: true});
    if (!client_js_template || enable_dev_mode) {
        client_js_template = fs.readFileSync(client_js_template_path, "utf8");
    }
    if (!client_html_template || enable_dev_mode) {
        client_html_template = fs.readFileSync(client_html_template_path, "utf8");
    }
    preview_panel.webview.html = client_html_template.replace('//__TEMPLATE_JS_CLIENT__', client_js_template);
    preview_panel.webview.onDidReceiveMessage(function(message) { handle_rbql_client_message(preview_panel.webview, message); });
}


function get_num_columns_if_delimited(active_doc, delim, policy, min_num_columns, min_num_lines) {
    var num_lines = active_doc.lineCount;
    let num_fields = 0;
    let num_lines_checked = 0;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix_for_autodetection = config ? config.get('comment_prefix') : '';
    if (!comment_prefix_for_autodetection)
        comment_prefix_for_autodetection = '#';
    for (var lnum = 0; lnum < num_lines; lnum++) {
        var line_text = active_doc.lineAt(lnum).text;
        if (lnum + 1 == num_lines && !line_text)
            break;
        if (line_text.startsWith(comment_prefix_for_autodetection))
            continue;
        let [fields, warning] = csv_utils.smart_split(line_text, delim, policy, true);
        if (warning)
            return 0; // TODO don't fail on warnings?
        if (!num_fields)
            num_fields = fields.length;
        if (num_fields < min_num_columns || num_fields != fields.length)
            return 0;
        num_lines_checked += 1;
    }
    return num_lines_checked >= min_num_lines ? num_fields : 0;
}


function autodetect_dialect(active_doc, candidate_separators) {
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let min_num_lines = config ? config.get('autodetection_min_line_count') : 10;
    if (active_doc.lineCount < min_num_lines)
        return null;

    let best_dialect = null;
    let best_dialect_num_columns = 1;
    for (let i = 0; i < candidate_separators.length; i++) {
        let dialect_id = map_separator_to_language_id(candidate_separators[i]);
        if (!dialect_id)
            continue;
        let [delim, policy] = dialect_map[dialect_id];
        let cur_dialect_num_columns = get_num_columns_if_delimited(active_doc, delim, policy, best_dialect_num_columns + 1, min_num_lines);
        if (cur_dialect_num_columns > best_dialect_num_columns) {
            best_dialect_num_columns = cur_dialect_num_columns;
            best_dialect = dialect_id;
        }
    }
    return best_dialect;
}


function autodetect_dialect_frequency_based(active_doc, candidate_separators) {
    let best_dialect = 'csv';
    let best_dialect_frequency = 0;
    let data = active_doc.getText();
    if (!data)
        return best_dialect;
    for (let i = 0; i < candidate_separators.length; i++) {
        if (candidate_separators[i] == ' ' || candidate_separators[i] == '.')
            continue; // Whitespace and dot have advantage over other separators in this algorithm, so we just skip them
        let dialect_id = map_separator_to_language_id(candidate_separators[i]);
        let frequency = 0;
        for (let j = 0; j < 10000 && j < data.length; j++) {
            if (data[j] == candidate_separators[i])
                frequency += 1;
        }
        if (frequency > best_dialect_frequency) {
            best_dialect = dialect_id;
            best_dialect_frequency = frequency;
        }
    }
    return best_dialect;
}


function autoenable_rainbow_csv(active_doc) {
    if (!active_doc)
        return;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    if (!config || !config.get('enable_separator_autodetection'))
        return;
    let candidate_separators = config.get('autodetect_separators');
    var original_language_id = active_doc.languageId;
    var file_path = active_doc.fileName;
    if (!file_path || autodetection_stoplist.has(file_path)) {
        return;
    }
    let is_default_csv = file_path.endsWith('.csv') && original_language_id == 'csv';
    if (original_language_id != 'plaintext' && !is_default_csv)
        return;
    let rainbow_csv_language_id = autodetect_dialect(active_doc, candidate_separators);
    if (!rainbow_csv_language_id && is_default_csv) {
        // Smart autodetection method has failed, but we need to choose a separator because this is a csv file. Let's just find the most popular one.
        rainbow_csv_language_id = autodetect_dialect_frequency_based(active_doc, candidate_separators);
    }
    if (!rainbow_csv_language_id || rainbow_csv_language_id == original_language_id)
        return;
    try_change_document_language(active_doc, rainbow_csv_language_id, false, (doc) => {
        original_language_ids.set(file_path, original_language_id);
        csv_lint(doc, false);
        refresh_status_bar_buttons(doc);
    });
}


function handle_editor_switch(editor) {
    let active_doc = get_active_doc(editor);
    csv_lint(active_doc, false);
    refresh_status_bar_buttons(active_doc);
}


function handle_doc_open(active_doc) {
    autoenable_rainbow_csv(active_doc);
    csv_lint(active_doc, false);
    refresh_status_bar_buttons(active_doc);
}


function quote_field(field, delim) {
    if (field.indexOf('"') != -1 || field.indexOf(delim) != -1) {
        return '"' + field.replace(/"/g, '""') + '"';
    }
    return field;
}


function quoted_join(fields, delim) {
    var quoted_fields = fields.map(function(val) { return quote_field(val, delim); });
    return quoted_fields.join(delim);
}


function make_preview(uri, preview_mode) {
    var file_path = uri.fsPath;
    if (!file_path || !fs.existsSync(file_path)) {
        vscode.window.showErrorMessage('Invalid file');
        return;
    }

    var size_limit = 1024000; // ~1MB
    var file_size_in_bytes = fs.statSync(file_path)['size'];
    if (file_size_in_bytes <= size_limit) {
        vscode.window.showWarningMessage('Too small to preview: Showing the original file instead');
        vscode.workspace.openTextDocument(file_path).then(doc => vscode.window.showTextDocument(doc));
        return;
    }

    let file_basename = path.basename(file_path);
    const out_path = path.join(os.tmpdir(), `.rb_csv_preview.${preview_mode}.${file_basename}`);

    fs.open(file_path, 'r', (err, fd) => {
        if (err) {
            console.log(err.message);
            vscode.window.showErrorMessage('Unable to preview file');
            return;
        }

        var buffer = Buffer.alloc(size_limit);
        let read_begin_pos = preview_mode == 'head' ? 0 : Math.max(file_size_in_bytes - size_limit, 0);
        fs.read(fd, buffer, 0, size_limit, read_begin_pos, function(err, _num) {
            if (err) {
                console.log(err.message);
                vscode.window.showErrorMessage('Unable to preview file');
                return;
            }

            const buffer_str = buffer.toString();
            // TODO handle old mac '\r' line endings - still used by Mac version of Excel
            let content = null;
            if (preview_mode == 'head') {
                content = buffer_str.substr(0, buffer_str.lastIndexOf(buffer_str.includes('\r\n') ? '\r\n' : '\n'));
            } else {
                content = buffer_str.substr(buffer_str.indexOf('\n') + 1);
            }
            fs.writeFileSync(out_path, content);
            vscode.workspace.openTextDocument(out_path).then(doc => vscode.window.showTextDocument(doc));
        });
    });
}


function register_csv_hover_info_provider(language_id, context) {
    let hover_provider = vscode.languages.registerHoverProvider(language_id, {
        provideHover(document, position, token) {
            return make_hover(document, position, language_id, token);
        }
    });
    context.subscriptions.push(hover_provider);
}


function activate(context) {
    global_state = context.globalState;

    client_js_template_path = context.asAbsolutePath('rbql_client.js');
    client_html_template_path = context.asAbsolutePath('rbql_client.html');
    mock_script_path = context.asAbsolutePath('rbql mock/rbql_mock.py');
    rbql_exec_path = context.asAbsolutePath('rbql_core/vscode_rbql.py');

    for (let language_id in dialect_map) {
        if (dialect_map.hasOwnProperty(language_id)) {
            register_csv_hover_info_provider(language_id, context);
        }
    }

    var lint_cmd = vscode.commands.registerCommand('extension.CSVLint', csv_lint_cmd);
    var rbql_cmd = vscode.commands.registerCommand('extension.RBQL', edit_rbql);
    var edit_column_names_cmd = vscode.commands.registerCommand('extension.SetVirtualHeader', edit_column_names);
    var set_join_table_name_cmd = vscode.commands.registerCommand('extension.SetJoinTableName', set_join_table_name);
    var column_edit_before_cmd = vscode.commands.registerCommand('extension.ColumnEditBefore', function() { column_edit('ce_before'); });
    var column_edit_after_cmd = vscode.commands.registerCommand('extension.ColumnEditAfter', function() { column_edit('ce_after'); });
    var column_edit_select_cmd = vscode.commands.registerCommand('extension.ColumnEditSelect', function() { column_edit('ce_select'); });
    var set_separator_cmd = vscode.commands.registerCommand('extension.RainbowSeparator', set_rainbow_separator);
    var rainbow_off_cmd = vscode.commands.registerCommand('extension.RainbowSeparatorOff', restore_original_language);
    var sample_head_cmd = vscode.commands.registerCommand('extension.SampleHead', uri => make_preview(uri, 'head'));
    var sample_tail_cmd = vscode.commands.registerCommand('extension.SampleTail', uri => make_preview(uri, 'tail'));
    var align_cmd = vscode.commands.registerTextEditorCommand('extension.Align', align_table);
    var shrink_cmd = vscode.commands.registerTextEditorCommand('extension.Shrink', shrink_table);
    var copy_back_cmd = vscode.commands.registerCommand('extension.CopyBack', copy_back);

    var doc_open_event = vscode.workspace.onDidOpenTextDocument(handle_doc_open);
    var switch_event = vscode.window.onDidChangeActiveTextEditor(handle_editor_switch);

    context.subscriptions.push(lint_cmd);
    context.subscriptions.push(rbql_cmd);
    context.subscriptions.push(edit_column_names_cmd);
    context.subscriptions.push(column_edit_before_cmd);
    context.subscriptions.push(column_edit_after_cmd);
    context.subscriptions.push(column_edit_select_cmd);
    context.subscriptions.push(doc_open_event);
    context.subscriptions.push(switch_event);
    context.subscriptions.push(set_separator_cmd);
    context.subscriptions.push(rainbow_off_cmd);
    context.subscriptions.push(sample_head_cmd);
    context.subscriptions.push(sample_tail_cmd);
    context.subscriptions.push(set_join_table_name_cmd);
    context.subscriptions.push(align_cmd);
    context.subscriptions.push(shrink_cmd);
    context.subscriptions.push(copy_back_cmd);

    setTimeout(function() {
        // Need this because "onDidOpenTextDocument()" doesn't get called for the first open document
        // Another issue is when dev debug logging mode is enabled, the first document would be "Log" because it is printing something and gets VSCode focus
        var active_doc = get_active_doc();
        handle_doc_open(active_doc);
    }, 1000);

}


exports.activate = activate;


function deactivate() {
    // This method is called when extension is deactivated
}


exports.deactivate = deactivate;
