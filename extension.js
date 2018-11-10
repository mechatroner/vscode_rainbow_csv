const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

const rainbow_utils = require('./rainbow_utils');
const rbql = require('./rbql_core/rbql-js/rbql');

var dialect_map = {'csv': [',', 'quoted'], 'tsv': ['\t', 'simple'], 'csv (semicolon)': [';', 'quoted'], 'csv (pipe)': ['|', 'simple']};

var dev_log = null;
var err_log = null;

var dbg_counter = 0;

var lint_results = new Map();
var autodetection_stoplist = new Set();
var original_language_ids = new Map();

var lint_status_bar_button = null;
var rbql_status_bar_button = null;
var rainbow_off_status_bar_button = null;

const preview_window_size = 12;

var rbql_context = null;

var last_rbql_queries = new Map();

var client_js_template_path = null;
var client_html_template_path = null;
var mock_script_path = null;
var rbql_exec_path = null;

var enable_dev_mode = false;
var enable_tooltip = true;
var enable_tooltip_column_names = true;
var enable_tooltip_warnings = true;

var client_js_template = null;
var client_html_template = null;

var global_state = null;

var preview_panel = null;


function dbg_log(msg) {
    if (!enable_dev_mode)
        return;
    if (!dev_log) {
        dev_log = vscode.window.createOutputChannel("rainbow_csv_dev");
    }
    dev_log.show();
    dev_log.appendLine(msg);
}


function log_error(msg) {
    if (!err_log) {
        err_log = vscode.window.createOutputChannel("rainbow_csv_errors");
    }
    err_log.show();
    err_log.appendLine(msg);
}


function map_separator_to_language_id(separator) {
    for (let dialect_name in dialect_map) {
        if (!dialect_map.hasOwnProperty(dialect_name))
            continue;
        if (dialect_map[dialect_name][0] == separator)
            return dialect_name;
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
        var cur_record = rainbow_utils.smart_split(line_text, delim, policy, false)[0];
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


function get_header(document, delim, policy) {
    var file_path = document.fileName;
    if (file_path && global_state) {
        var header = global_state.get(file_path);
        if (header) {
            return rainbow_utils.smart_split(header, ',', 'quoted', false)[0];
        }
    }
    return rainbow_utils.smart_split(document.lineAt(0).text, delim, policy, false)[0];
}


function make_hover_text(document, position, language_id) {
    var delim = dialect_map[language_id][0];
    var policy = dialect_map[language_id][1];
    var lnum = position.line;
    var cnum = position.character;
    var line = document.lineAt(lnum).text;

    var report = rainbow_utils.smart_split(line, delim, policy, true);

    var entries = report[0];
    var warning = report[1];
    var col_num = rainbow_utils.get_field_by_line_position(entries, cnum + 1);

    if (col_num == null)
        return null;
    var result = 'Col #' + (col_num + 1);

    var header = get_header(document, delim, policy);
    if (enable_tooltip_column_names && col_num < header.length) {
        const max_label_len = 50;
        var column_label = header[col_num].substr(0, max_label_len);
        if (column_label != header[col_num])
            column_label = column_label + '...';
        result += ', Header: "' + column_label + '"';
    }
    if (enable_tooltip_warnings && header.length != entries.length)
        result += "; WARN: num of fields in Header and this line differs";
    if (enable_tooltip_warnings && warning)
        result += '; This line has quoting error';
    return result;
}


function make_hover(document, position, language_id, cancellation_token) {
    if (!enable_tooltip)
        return;
    var hover_text = make_hover_text(document, position, language_id);
    if (hover_text && !cancellation_token.isCancellationRequested) {
        return new vscode.Hover(hover_text);
    } else {
        return null;
    }
}


function produce_lint_report(active_doc, delim, policy, max_check_size) {
    var num_lines = active_doc.lineCount;
    var num_fields = null;
    for (var lnum = 0; lnum < num_lines; lnum++) {
        var line_text = active_doc.lineAt(lnum).text;
        if (lnum + 1 == num_lines && !line_text)
            break;
        var split_result = rainbow_utils.smart_split(line_text, delim, policy, false);
        if (split_result[1]) {
            return 'Error. Line ' + (lnum + 1) + ' has formatting error: double quote chars are not consistent';
        }
        if (lnum === 0)
            num_fields = split_result[0].length;
        if (num_fields != split_result[0].length) {
            return 'Error. Number of fields is not consistent: e.g. line 1 has ' + num_fields + ' fields, and line ' + (lnum + 1) + ' has ' + split_result[0].length + ' fields.';
        }
        if (max_check_size && lnum > max_check_size) {
            return 'File is too big: autocheck was cancelled';
        }
    }
    return 'OK';
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
    } else if (lint_report.indexOf('File is too big') != -1 || lint_report == 'Processing...') {
        lint_status_bar_button.color = '#ffff28';
    } else {
        lint_status_bar_button.color = '#f44242';
    }
    lint_status_bar_button.tooltip = lint_report + '\nClick to recheck';
    lint_status_bar_button.command = 'extension.CSVLint';
    lint_status_bar_button.show();
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


function refresh_status_bar_buttons(active_doc=null) {
    if (!active_doc)
        active_doc = get_active_doc();
    if (!active_doc)
        return;
    let all_buttons = [lint_status_bar_button, rbql_status_bar_button, rainbow_off_status_bar_button];
    for (let i = 0; i < all_buttons.length; i++) {
        if (all_buttons[i])
            all_buttons[i].hide();
    }
    var language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    var file_path = active_doc.fileName;
    show_lint_status_bar_button(file_path, language_id);
    show_rbql_status_bar_button();
    show_rainbow_off_status_bar_button();
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
    lint_results.set(lint_cache_key, 'Processing...');
    refresh_status_bar_buttons(active_doc); // Visual feedback
    var delim = dialect_map[language_id][0];
    var policy = dialect_map[language_id][1];
    var max_check_size = is_manual_op ? null : 50000;
    var lint_report = produce_lint_report(active_doc, delim, policy, max_check_size);
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
    active_window.showWarningMessage('RBQL query succeed with warnings!');
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


function handle_rbql_result_file(text_doc, warnings) {
    var out_delim = rbql_context.delim;
    let language_id = map_separator_to_language_id(out_delim);
    var active_window = vscode.window;
    if (!active_window)
        return;
    var handle_success = function(editor) { 
        if (language_id && text_doc.language_id != language_id) {
            console.log('changing RBQL result language');
            try_change_document_language(text_doc, language_id, false);
        }
        show_warnings(warnings); 
    };
    var handle_failure = function(reason) { show_single_line_error('Unable to open document'); };
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
        dbg_log('child_process got "close" event');
        if (!close_and_error_guard['process_reported']) {
            close_and_error_guard['process_reported'] = true;
            callback_func(code, stdout, stderr);
        }
    });
    command.on('error', function(error) {
        dbg_log('child_process got "error" event');
        var error_msg = error ? error.name + ': ' + error.message : '';
        if (!close_and_error_guard['process_reported']) {
            close_and_error_guard['process_reported'] = true;
            callback_func(1, '', 'Something went wrong. Make sure you have python installed and added to PATH variable in your OS. Or you can use it with JavaScript instead - it should work out of the box\nDetails:\n' + error_msg);
        }
    });
}


function handle_command_result(error_code, stdout, stderr, report_handler) {
    dbg_log('error_code: ' + String(error_code));
    dbg_log('stdout: ' + String(stdout));
    dbg_log('stderr: ' + String(stderr));

    var report = null;
    var json_report = stdout;
    if (error_code || !json_report.length || stderr.length) {
        var error_details = "Unknown Integration Error";
        if (stderr.length) {
            error_details += '\nstderr: ' + stderr;
        }
        report = {"error_type": "Integration", "error_details": error_details};
    } else {
        try {
            report = JSON.parse(json_report);
        } catch (e) {
            report = {"error_type": "Integration", "error_details": "Report JSON parsing error"};
        }
    }
    report_handler(report);
    if (report.hasOwnProperty('error_type') || report.hasOwnProperty('error_details')) {
        return; // Just exit: error would be shown in the preview window.
    }
    var warnings = [];
    if (report.hasOwnProperty('warnings')) {
        warnings = report['warnings'];
    }
    if (!report.hasOwnProperty('result_path')) {
        show_single_line_error('Something went terribly wrong: RBQL JSON report is missing result_path attribute');
        return;
    }
    var dst_table_path = report['result_path'];
    dbg_log('dst_table_path: ' + dst_table_path);
    autodetection_stoplist.add(dst_table_path);
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


function remove_if_exists(file_path) {
    if (fs.existsSync(file_path)) {
        fs.unlinkSync(file_path);
    }
}


function handle_worker_success(output_path, warnings, tmp_worker_module_path, report_handler) {
    dbg_log('Worker success');
    remove_if_exists(tmp_worker_module_path);
    let hr_warnings = [];
    let report = {'result_path': output_path};
    if (warnings) {
        hr_warnings = rbql.make_warnings_human_readable(warnings);
        report['warnings'] = hr_warnings; 
    }
    report_handler(report);
    autodetection_stoplist.add(output_path);
    vscode.workspace.openTextDocument(output_path).then(doc => handle_rbql_result_file(doc, hr_warnings));
}


function handle_worker_failure(error_msg, tmp_worker_module_path, report_handler) {
    dbg_log('Worker failure: ' + error_msg);
    var report = {'error_type': 'RBQL_backend', 'error_details': error_msg};
    report_handler(report);
}


function get_error_message(error) {
    if (error && error.message)
        return error.message;
    return String(error);
}


function run_rbql_native(input_path, query, delim, policy, report_handler) {
    var rbql_lines = [query];
    var tmp_dir = os.tmpdir();
    var script_filename = 'rbconvert_' + String(Math.random()).replace('.', '_') + '.js';
    var tmp_worker_module_path = path.join(tmp_dir, script_filename);
    var output_delim = delim;
    var output_policy = policy;
    var csv_encoding = rbql.default_csv_encoding;

    var output_file_name = get_dst_table_name(input_path, output_delim);
    var output_path = path.join(tmp_dir, output_file_name);
    var worker_module = null;

    try {
        rbql.parse_to_js(input_path, output_path, rbql_lines, tmp_worker_module_path, delim, policy, output_delim, output_policy, csv_encoding);
        worker_module = require(tmp_worker_module_path);
    } catch (e) {
        let report = {'error_type': 'RBQL_parsing', 'error_details': get_error_message(e)};
        report_handler(report);
        return;
    }
    var handle_success = function(warnings) {
        handle_worker_success(output_path, warnings, tmp_worker_module_path, report_handler);
    }
    var handle_failure = function(error_msg) {
        handle_worker_failure(error_msg, tmp_worker_module_path, report_handler);
    }
    worker_module.run_on_node(handle_success, handle_failure);
}


function run_rbql_query(active_file_path, backend_language, rbql_query, report_handler) {
    dbg_log('running query: ' + rbql_query);
    last_rbql_queries.set(active_file_path, {'query': rbql_query});
    var cmd = 'python';
    const test_marker = 'test ';
    let close_and_error_guard = {'process_reported': false};
    if (rbql_query.startsWith(test_marker)) {
        if (rbql_query.indexOf('nopython') != -1) {
            cmd = 'nopython';
        }
        let args = [mock_script_path, rbql_query];
        run_command(cmd, args, close_and_error_guard, function(error_code, stdout, stderr) { handle_command_result(error_code, stdout, stderr, report_handler); });
        return;
    }
    if (backend_language == 'js') {
        run_rbql_native(active_file_path, rbql_query, rbql_context.delim, rbql_context.policy, report_handler);
    } else {
        let args = [rbql_exec_path, backend_language, rbql_context.delim, rbql_context.policy, rbql_query, active_file_path];
        run_command(cmd, args, close_and_error_guard, function(error_code, stdout, stderr) { handle_command_result(error_code, stdout, stderr, report_handler); });
    }
}


function init_rbql_context() {
    var active_window = vscode.window;
    if (!active_window)
        return false;
    var active_editor = active_window.activeTextEditor;
    if (!active_editor)
        return false;
    var active_doc = active_editor.document;
    if (!active_doc)
        return false;
    var orig_uri = active_doc.uri;
    if (!orig_uri || orig_uri.scheme != 'file')
        return false;
    var language_id = active_doc.languageId;
    var delim = 'monocolumn';
    var policy = 'monocolumn';
    if (dialect_map.hasOwnProperty(language_id)) {
        delim = dialect_map[language_id][0];
        policy = dialect_map[language_id][1];
    }
    rbql_context = {"document": active_doc, "line": 0, "delim": delim, "policy": policy};
    return true;
}


function process_rbql_quick(active_file_path, backend_language, query) {
    if (!query)
        return;
    var report_handler = function(report) {
        if (!report)
            return;
        var error_type = report['error_type'];
        var error_details = report['error_details'];
        if (error_type || error_details) {
            show_single_line_error('RBQL error, check OUTPUT.rainbow_csv_errors VS Code log at the bottom for details.');
            log_error('=====\nRBQL Error while executing query: ' + query);
            log_error('Error Type: ' + error_type);
            log_error('Error Details: ' + error_details);
        }
    }
    run_rbql_query(active_file_path, backend_language, query, report_handler);
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

function try_change_document_language(active_doc, language_id, is_manual_op) {
    try {
        vscode.languages.setTextDocumentLanguage(active_doc, language_id);
    } catch (error) {
        dbg_log('Unable to change language: ' + error);
        if (is_manual_op)
            show_single_line_error("Unable to proceed. Minimal VSCode version required: 1.28");
        return false;
    }
    return true;
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
    if (try_change_document_language(active_doc, language_id, true)) {
        original_language_ids.set(active_doc.fileName, original_language_id);
        csv_lint(active_doc, false);
        refresh_status_bar_buttons(active_doc);
    }
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
    if (try_change_document_language(active_doc, original_language_id, true)) {
        original_language_ids.delete(file_path);
        refresh_status_bar_buttons(active_doc);
    }
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
    var handle_success = function(new_header) { save_new_header(file_path, new_header); }
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

    let position = active_editor.selection.active;
    let lnum = position.line;
    let cnum = position.character;
    let line = active_doc.lineAt(lnum).text;

    let report = rainbow_utils.smart_split(line, delim, policy, true);

    let entries = report[0];
    let quoting_warning = report[1];
    let col_num = rainbow_utils.get_field_by_line_position(entries, cnum + 1);

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
        let report = rainbow_utils.smart_split(line_text, delim, policy, true);
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


function edit_rbql_quick() {
    if (!init_rbql_context())
        return;
    var active_file_path = rbql_context['document'].fileName;
    var backend_language = get_rbql_backend_language();
    var title = "Input SQL-like RBQL query [in " + backend_language + "]  ";
    var handle_success = function(query) { process_rbql_quick(active_file_path, backend_language, query); }
    var handle_failure = function(reason) { show_single_line_error('Unable to create input box: ' + reason); };
    var input_box_props = {"ignoreFocusOut": true, "prompt": title, "placeHolder": "select ... where ... order by ... limit ..."};
    if (last_rbql_queries.has(active_file_path)) {
        var last_query_info = last_rbql_queries.get(active_file_path);
        input_box_props['value'] = last_query_info['query'];
    }
    vscode.window.showInputBox(input_box_props).then(handle_success, handle_failure);
}



function handle_rbql_client_message(webview, message) {
    dbg_log('got message from rbql client: ' + JSON.stringify(message));
    let message_type = message['msg_type'];

    if (message_type == 'handshake') {
        var active_file_path = rbql_context['document'].fileName;
        var init_msg = {'msg_type': 'handshake', 'backend_language': get_rbql_backend_language()};
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
        var report_handler = function(report) {
            var report_msg = {'msg_type': 'rbql_report', 'report': report};
            webview.postMessage(report_msg);
        }
        var active_file_path = rbql_context['document'].fileName;
        run_rbql_query(active_file_path, backend_language, rbql_query, report_handler);
    }

    if (message_type == 'backend_language_change') {
        let backend_language = message['backend_language'];
        if (global_state) {
            global_state.update('rbql_backend_language', backend_language);
        }
    }
}


function edit_rbql() {
    // TODO add encoding and output format parameters
    if (!init_rbql_context())
        return null;
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


function get_rbql_backend_language() {
    if (global_state) {
        var backend_language = global_state.get('rbql_backend_language');
        if (backend_language)
            return backend_language;
    }
    return 'js';
}


function is_delimited_table(active_doc, delim, policy) {
    var num_lines = active_doc.lineCount;
    if (num_lines < 10)
        return false;
    let num_fields = null;
    for (var lnum = 0; lnum < num_lines; lnum++) {
        var line_text = active_doc.lineAt(lnum).text;
        if (lnum + 1 == num_lines && !line_text)
            break;
        let [fields, warning] = rainbow_utils.smart_split(line_text, delim, policy, true);
        if (warning)
            return false; // TODO don't fail on warnings in future versions
        if (num_fields === null) {
            num_fields = fields.length;
            if (num_fields < 2)
                return false;
        }
        if (num_fields != fields.length)
            return false;
    }
    return true;
}


function autodetect_dialect(active_doc, candidate_separators) {
    for (var i = 0; i < candidate_separators.length; i++) {
        var dialect_id = map_separator_to_language_id(candidate_separators[i]);
        if (!dialect_id || !dialect_map.hasOwnProperty(dialect_id)) {
            continue;
        }
        var [delim, policy] = dialect_map[dialect_id];
        if (is_delimited_table(active_doc, delim, policy))
            return dialect_id;
    }
    return null;
}


function autoenable_rainbow_csv(active_doc) {
    if (!active_doc)
        return;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    if (!config || !config.get('enable_separator_autodetection'))
        return
    let candidate_separators = config.get('autodetect_separators');
    var original_language_id = active_doc.languageId;
    if (['plaintext', 'csv'].indexOf(original_language_id) == -1)
        return;
    var file_path = active_doc.fileName;
    if (autodetection_stoplist.has(file_path)) {
        return;
    }
    let rainbow_csv_language_id = null;
    if (original_language_id == 'csv') {
        let alternative_candidates = candidate_separators.slice(0);
        let comma_idx = alternative_candidates.indexOf(',');
        if (comma_idx != -1) {
            alternative_candidates.splice(comma_idx, 1);
        }
        rainbow_csv_language_id = autodetect_dialect(active_doc, alternative_candidates);
        if (rainbow_csv_language_id && is_delimited_table(active_doc, ',', 'quoted')) {
            rainbow_csv_language_id = null;
        }
    } else {
        rainbow_csv_language_id = autodetect_dialect(active_doc, candidate_separators);
    }
    if (!rainbow_csv_language_id)
        return;
    if (try_change_document_language(active_doc, rainbow_csv_language_id, false)) {
        original_language_ids.set(file_path, original_language_id);
        csv_lint(active_doc, false);
        refresh_status_bar_buttons(active_doc);
    }
}


function handle_editor_switch(editor) {
    dbg_counter += 1;
    let active_doc = get_active_doc(editor);
    csv_lint(active_doc, false);
    refresh_status_bar_buttons(active_doc);
}


function handle_doc_open(active_doc) {
    dbg_counter += 1;
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
        fs.read(fd, buffer, 0, size_limit, read_begin_pos, function(err, num) {
            if (err) {
                console.log(err.message);
                vscode.window.showErrorMessage('Unable to preview file');
                return;
            }

            const buffer_str = buffer.toString();
            // TODO handle old mac '\r' line endings
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

function activate(context) {
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    if (config) {
        if (config.get('enable_dev_mode') === true)
            enable_dev_mode = true;
        if (config.get('enable_tooltip') === false)
            enable_tooltip = false;
        if (config.get('enable_tooltip_column_names') === false)
            enable_tooltip_column_names = false;
        if (config.get('enable_tooltip_warnings') === false)
            enable_tooltip_warnings = false;
    }

    global_state = context.globalState;

    client_js_template_path = context.asAbsolutePath('rbql_client.js');
    client_html_template_path = context.asAbsolutePath('rbql_client.html');
    mock_script_path = context.asAbsolutePath('rbql mock/rbql_mock.py');
    rbql_exec_path = context.asAbsolutePath('rbql_core/vscode_rbql.py');

    var csv_provider = vscode.languages.registerHoverProvider('csv', {
        provideHover(document, position, token) {
            return make_hover(document, position, 'csv', token);
        }
    });

    var tsv_provider = vscode.languages.registerHoverProvider('tsv', {
        provideHover(document, position, token) {
            return make_hover(document, position, 'tsv', token);
        }
    });

    var scsv_provider = vscode.languages.registerHoverProvider('csv (semicolon)', {
        provideHover(document, position, token) {
            return make_hover(document, position, 'csv (semicolon)', token);
        }
    });

    var pipe_provider = vscode.languages.registerHoverProvider('csv (pipe)', {
        provideHover(document, position, token) {
            return make_hover(document, position, 'csv (pipe)', token);
        }
    });

    var lint_cmd = vscode.commands.registerCommand('extension.CSVLint', csv_lint_cmd);
    var rbql_cmd = vscode.commands.registerCommand('extension.RBQL', edit_rbql);
    var quick_rbql_cmd = vscode.commands.registerCommand('extension.QueryHere', edit_rbql_quick);
    var edit_column_names_cmd = vscode.commands.registerCommand('extension.SetVirtualHeader', edit_column_names);
    var set_join_table_name_cmd = vscode.commands.registerCommand('extension.SetJoinTableName', set_join_table_name);
    var column_edit_before_cmd = vscode.commands.registerCommand('extension.ColumnEditBefore', function() { column_edit('ce_before'); });
    var column_edit_after_cmd = vscode.commands.registerCommand('extension.ColumnEditAfter', function() { column_edit('ce_after'); });
    var column_edit_select_cmd = vscode.commands.registerCommand('extension.ColumnEditSelect', function() { column_edit('ce_select'); });
    var set_separator_cmd = vscode.commands.registerCommand('extension.RainbowSeparator', set_rainbow_separator);
    var rainbow_off_cmd = vscode.commands.registerCommand('extension.RainbowSeparatorOff', restore_original_language);
    var sample_head_cmd = vscode.commands.registerCommand('extension.SampleHead', uri => make_preview(uri, 'head'));
    var sample_tail_cmd = vscode.commands.registerCommand('extension.SampleTail', uri => make_preview(uri, 'tail'));

    var doc_open_event = vscode.workspace.onDidOpenTextDocument(handle_doc_open);
    var switch_event = vscode.window.onDidChangeActiveTextEditor(handle_editor_switch);

    context.subscriptions.push(csv_provider);
    context.subscriptions.push(tsv_provider);
    context.subscriptions.push(scsv_provider);
    context.subscriptions.push(pipe_provider);
    context.subscriptions.push(lint_cmd);
    context.subscriptions.push(rbql_cmd);
    context.subscriptions.push(quick_rbql_cmd);
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
