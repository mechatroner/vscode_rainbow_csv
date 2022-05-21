const vscode = require('vscode');

const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');

// Please see DEV_README.md file for additional info.

const csv_utils = require('./rbql_core/rbql-js/csv_utils.js');

var rbql_csv = null; // Using lazy load to improve startup performance.
function ll_rbql_csv() {
    if (rbql_csv === null)
        rbql_csv = require('./rbql_core/rbql-js/rbql_csv.js');
    return rbql_csv;
}


var rainbow_utils = null; // Using lazy load to improve startup performance.
function ll_rainbow_utils() {
    if (rainbow_utils === null)
        rainbow_utils = require('./rainbow_utils.js');
    return rainbow_utils;
}


const is_web_ext = (os.homedir === undefined); // Runs as web extension in browser.
const preview_window_size = 100;
const max_preview_field_length = 250;
const scratch_buf_marker = 'vscode_rbql_scratch';

let client_html_template_web = null;

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
var column_info_button = null;

let last_statusbar_doc = null;

var rbql_context = null;

var last_rbql_queries = new Map(); // Query history does not replace this structure, it is also used to store partially entered queries for preview window switch.

var client_html_template = null;

var global_state = null;

var preview_panel = null;

var doc_edit_subscription = null;
var keyboard_cursor_subscription = null;

var _unit_test_last_rbql_report = null; // For unit tests only.
var _unit_test_last_warnings = null; // For unit tests only.

let cursor_timeout_handle = null;

const dialect_map = {
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


// This structure will get properly initialized during the startup.
let absolute_path_map = {
    'rbql_client.js': null,
    'contrib/textarea-caret-position/index.js': null,
    'rbql_suggest.js': null,
    'rbql_logo.svg': null,
    'rbql_client.html': null,
    'rbql mock/rbql_mock.py': null,
    'rbql_core/vscode_rbql.py': null
};


function show_single_line_error(error_msg) {
    var active_window = vscode.window;
    if (!active_window)
        return;
    // Do not "await" error messages because the promise gets resolved only on error dismissal.
    active_window.showErrorMessage(error_msg);
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function push_current_stack_to_js_callback_queue_to_allow_ui_update() {
    await sleep(0);
}


function map_separator_to_language_id(separator) {
    for (let language_id in dialect_map) {
        if (!dialect_map.hasOwnProperty(language_id))
            continue;
        if (dialect_map[language_id][0] == separator)
            return language_id;
    }
    return null;
}


function get_from_global_state(key, default_value) {
    if (global_state) {
        var value = global_state.get(key);
        if (value !== null && value !== undefined)
            return value;
    }
    return default_value;
}


async function save_to_global_state(key, value) {
    if (global_state && key) {
        await global_state.update(key, value);
        return true;
    }
    return false;
}


function get_rfc_record_text(document, record_start, record_end) {
    let result = [];
    for (let i = record_start; i < record_end && i < document.lineCount; i++) {
        result.push(document.lineAt(i).text);
    }
    return result.join('\n');
}


async function replace_doc_content(active_editor, active_doc, new_content) {
    let invalid_range = new vscode.Range(0, 0, active_doc.lineCount /* Intentionally missing the '-1' */, 0);
    let full_range = active_doc.validateRange(invalid_range);
    await active_editor.edit(edit => edit.replace(full_range, new_content));
}


function sample_preview_records_from_context(rbql_context, dst_message) {
    let document = rbql_context.input_document;
    let delim = rbql_context.delim;
    let policy = rbql_context.policy;

    rbql_context.requested_start_record = Math.max(rbql_context.requested_start_record, 0);

    let preview_records = [];
    if (rbql_context.enable_rfc_newlines) {
        let requested_end_record = rbql_context.requested_start_record + preview_window_size;
        ll_rainbow_utils().populate_optimistic_rfc_csv_record_map(document, requested_end_record, rbql_context.rfc_record_map);
        rbql_context.requested_start_record = Math.max(0, Math.min(rbql_context.requested_start_record, rbql_context.rfc_record_map.length - preview_window_size));
        for (let nr = rbql_context.requested_start_record; nr < rbql_context.rfc_record_map.length && preview_records.length < preview_window_size; nr++) {
            let [record_start, record_end] = rbql_context.rfc_record_map[nr];
            let record_text = get_rfc_record_text(document, record_start, record_end);
            let [cur_record, warning] = csv_utils.smart_split(record_text, delim, policy, false);
            if (warning) {
                dst_message.preview_sampling_error = `Double quotes are not consistent in record ${nr + 1} which starts at line ${record_start + 1}`;
                return;
            }
            preview_records.push(cur_record);
        }
    } else {
        let num_records = document.lineCount;
        if (document.lineAt(Math.max(num_records - 1, 0)).text == '')
            num_records -= 1;
        rbql_context.requested_start_record = Math.max(0, Math.min(rbql_context.requested_start_record, num_records - preview_window_size));
        for (let nr = rbql_context.requested_start_record; nr < num_records && preview_records.length < preview_window_size; nr++) {
            let line_text = document.lineAt(nr).text;
            let cur_record = csv_utils.smart_split(line_text, delim, policy, false)[0];
            preview_records.push(cur_record);
        }
    }

    for (let r = 0; r < preview_records.length; r++) {
        let cur_record = preview_records[r];
        for (let c = 0; c < cur_record.length; c++) {
            if (cur_record[c].length > max_preview_field_length) {
                cur_record[c] = cur_record[c].substr(0, max_preview_field_length) + '###UI_STRING_TRIM_MARKER###';
            }
        }
    }
    dst_message.preview_records = preview_records;
    dst_message.start_record_zero_based = rbql_context.requested_start_record;
}


function make_header_key(file_path) {
    return 'rbql_header:' + file_path;
}


function make_rfc_policy_key(file_path) {
    return 'enable_rfc_newlines:' + file_path;
}


function make_with_headers_key(file_path) {
    return 'rbql_with_headers:' + file_path;
}


function get_from_config(param_name, default_value) {
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    return config ? config.get(param_name) : default_value;
}


function get_header_from_document(document, delim, policy) {
    let comment_prefix = get_from_config('comment_prefix', '');
    let header_line = ll_rainbow_utils().get_header_line(document, comment_prefix);
    return csv_utils.smart_split(header_line, delim, policy, /*preserve_quotes_and_whitespaces=*/false)[0];
}


function get_header(document, delim, policy) {
    var file_path = document.fileName;
    if (file_path) {
        let raw_header = get_from_global_state(make_header_key(file_path), null);
        if (raw_header) {
            return JSON.parse(raw_header);
        }
    }
    return get_header_from_document(document, delim, policy);
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

    let comment_prefix = get_from_config('comment_prefix', '');
    if (comment_prefix && line.startsWith(comment_prefix))
        return 'Comment';

    var report = csv_utils.smart_split(line, delim, policy, true);

    var entries = report[0];
    var warning = report[1];
    var col_num = get_field_by_line_position(entries, cnum + 1);

    if (col_num == null)
        return null;
    var result = 'Col ' + (col_num + 1);

    var header = get_header(document, delim, policy);
    if (enable_tooltip_column_names && col_num < header.length) {
        const max_label_len = 50;
        let column_label = header[col_num].trim();
        var short_column_label = column_label.substr(0, max_label_len);
        if (short_column_label != column_label)
            short_column_label = short_column_label + '...';
        result += ', ' + short_column_label;
    }
    if (enable_tooltip_warnings) {
        if (warning) {
            result += '; ERR: Inconsistent double quotes in line';
        } else if (header.length != entries.length) {
            result += `; WARN: Inconsistent num of fields, header: ${header.length}, this line: ${entries.length}`;
        }
    }
    return result;
}


function make_status_info(document, position, language_id, enable_tooltip_column_names) {
    let [delim, policy] = dialect_map[language_id];
    var lnum = position.line;
    var cnum = position.character;
    var line = document.lineAt(lnum).text;

    let comment_prefix = get_from_config('comment_prefix', '');
    if (comment_prefix && line.startsWith(comment_prefix))
        return null;

    var report = csv_utils.smart_split(line, delim, policy, true);

    var entries = report[0];
    var warning = report[1];
    if (warning)
        return null;
    var col_num = get_field_by_line_position(entries, cnum + 1);

    if (col_num == null)
        return null;
    var result = 'CSV: ' + (col_num + 1);

    var header = get_header(document, delim, policy);
    if (header.length != entries.length)
        return null;

    if (enable_tooltip_column_names && col_num < header.length) {
        let column_label = header[col_num].trim();
        result += ', ' + column_label;
    }
    return result;
}


function refresh_status_bar_items(active_doc=null) {
    if (!active_doc)
        active_doc = get_active_doc();
    last_statusbar_doc = active_doc;
    var file_path = active_doc ? active_doc.fileName : null;
    if (!active_doc || !file_path) {
        // For new untitled scratch documents `file_path` would be "Untitled-1", "Untitled-2", etc, so we won't enter this branch.
        hide_status_bar_buttons();
        return;
    }
    if (file_path.endsWith('.git')) {
        // Sometimes for git-controlled dirs VSCode opens mysterious .git files. Skip them, don't hide buttons.
        return;
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
    show_column_info_button();
    if (get_from_config('enable_cursor_position_info', false)) {
        keyboard_cursor_subscription = vscode.window.onDidChangeTextEditorSelection(handle_cursor_movement);
    }
}


function make_hover(document, position, language_id, cancellation_token) {
    if (last_statusbar_doc != document) {
        refresh_status_bar_items(document); // Being paranoid and making sure that the buttons are visible.
    }
    if (!get_from_config('enable_tooltip', false)) {
        return;
    }
    let enable_tooltip_column_names = get_from_config('enable_tooltip_column_names', false);
    let enable_tooltip_warnings = get_from_config('enable_tooltip_warnings', false);
    var hover_text = make_hover_text(document, position, language_id, enable_tooltip_column_names, enable_tooltip_warnings);
    if (hover_text && !cancellation_token.isCancellationRequested) {
        let mds = null;
        try {
            mds = new vscode.MarkdownString();
            mds.appendCodeblock(hover_text, 'rainbow hover markup');
        } catch (e) {
            mds = hover_text; // Older VSCode versions may not have MarkdownString/appendCodeblock functionality.
        }
        return new vscode.Hover(mds);
    } else {
        return null;
    }
}


function produce_lint_report(active_doc, delim, policy) {
    let comment_prefix = get_from_config('comment_prefix', '');
    let detect_trailing_spaces = get_from_config('csv_lint_detect_trailing_spaces', false);
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
    lint_status_bar_button.command = 'rainbow-csv.CSVLint';
    lint_status_bar_button.show();
}


function show_align_shrink_button(file_path) {
    if (!align_shrink_button)
        align_shrink_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    if (aligned_files.has(file_path)) {
        align_shrink_button.text = 'Shrink';
        align_shrink_button.tooltip = 'Click to shrink table (Then you can click again to align)';
        align_shrink_button.command = 'rainbow-csv.Shrink';
    } else {
        align_shrink_button.text = 'Align';
        align_shrink_button.tooltip = 'Click to align table (Then you can click again to shrink)';
        align_shrink_button.command = 'rainbow-csv.Align';
    }
    align_shrink_button.show();
}


function do_show_column_info_button(status_text) {
    if (!column_info_button)
        column_info_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    const max_len = 25;
    let short_info = status_text.length > max_len ? status_text.substring(0, max_len - '...'.length + 1) + '...' : status_text;
    column_info_button.text = short_info;
    column_info_button.tooltip = status_text;
    column_info_button.show();
}


function show_column_info_button() {
    let active_editor = get_active_editor();
    if (!active_editor) {
        return false;
    }
    let selections = active_editor.selections;
    if (!selections || selections.length != 1) {
        // Support only single-cursor info reporting.
        return false;
    }
    let selection = selections[0];
    let position = selection.active;
    if (!position.isEqual(selection.anchor)) {
        // Do not report CSV columns for selections.
        return false;
    }
    let enable_tooltip_column_names = get_from_config('enable_tooltip_column_names', false);
    let active_doc = get_active_doc(active_editor);
    let language_id = active_doc.languageId;
    let status_text = make_status_info(active_doc, position, language_id, enable_tooltip_column_names);
    if (!status_text)
        return false;
    do_show_column_info_button(status_text);
    return true;
}


function show_rainbow_off_status_bar_button() {
    if (!rainbow_off_status_bar_button)
        rainbow_off_status_bar_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    rainbow_off_status_bar_button.text = 'Rainbow OFF';
    rainbow_off_status_bar_button.tooltip = 'Click to restore original file type and syntax';
    rainbow_off_status_bar_button.command = 'rainbow-csv.RainbowSeparatorOff';
    rainbow_off_status_bar_button.show();
}


function show_rbql_status_bar_button() {
    if (!rbql_status_bar_button)
        rbql_status_bar_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    rbql_status_bar_button.text = 'Query';
    rbql_status_bar_button.tooltip = 'Click to run SQL-like RBQL query';
    rbql_status_bar_button.command = 'rainbow-csv.RBQL';
    rbql_status_bar_button.show();
}


function hide_status_bar_buttons() {
    let all_buttons = [lint_status_bar_button, rbql_status_bar_button, rainbow_off_status_bar_button, copy_back_button, align_shrink_button, column_info_button];
    for (let i = 0; i < all_buttons.length; i++) {
        if (all_buttons[i])
            all_buttons[i].hide();
    }
    if (keyboard_cursor_subscription) {
        keyboard_cursor_subscription.dispose();
        keyboard_cursor_subscription = null;
    }
}


function show_rbql_copy_to_source_button(file_path) {
    let parent_table_path = result_set_parent_map.get(file_path.toLowerCase());
    if (!parent_table_path || parent_table_path.indexOf(scratch_buf_marker) != -1)
        return;
    let parent_basename = path.basename(parent_table_path);
    if (!copy_back_button)
        copy_back_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    copy_back_button.text = 'Copy Back';
    copy_back_button.tooltip = `Copy to parent table: ${parent_basename}`;
    copy_back_button.command = 'rainbow-csv.CopyBack';
    copy_back_button.show();
}


function csv_lint(active_doc, is_manual_op) {
    if (!active_doc)
        active_doc = get_active_doc();
    if (!active_doc)
        return null;
    var file_path = active_doc.fileName; // For new untitled scratch documents this would be "Untitled-1", "Untitled-2", etc...
    if (!file_path)
        return null;
    var language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return null;
    let lint_cache_key = `${file_path}.${language_id}`;
    if (!is_manual_op) {
        if (lint_results.has(lint_cache_key))
            return null;
        if (!get_from_config('enable_auto_csv_lint', false))
            return null;
    }
    lint_results.set(lint_cache_key, 'Processing...');
    refresh_status_bar_items(active_doc); // Visual feedback.
    let [delim, policy] = dialect_map[language_id];
    var lint_report = produce_lint_report(active_doc, delim, policy);
    lint_results.set(lint_cache_key, lint_report);
    return lint_report;
}


async function csv_lint_cmd() {
    // TODO re-run on each file save with content change.
    let lint_report = csv_lint(null, true);
    // Need timeout here to give user enough time to notice green -> yellow -> green switch, this is a sort of visual feedback.
    await sleep(500);
    refresh_status_bar_items();
    return lint_report;
}


async function run_internal_test_cmd(integration_test_options) {
    if (integration_test_options && integration_test_options.check_initialization_state) {
        // This mode is to ensure that the most basic operations do not cause rainbow csv to load extra (potentially heavy) code.
        // Vim uses the same approach with its plugin/autoload folder layout design.
        return {initialized: global_state !== null, lazy_loaded: rainbow_utils !== null};
    }
    if (integration_test_options && integration_test_options.check_last_rbql_report) {
        return _unit_test_last_rbql_report;
    }
    if (integration_test_options && integration_test_options.check_last_rbql_warnings) {
        return {'warnings': _unit_test_last_warnings};
    }
    return null;
}


async function show_warnings(warnings) {
    _unit_test_last_warnings = [];
    if (!warnings || !warnings.length)
        return;
    var active_window = vscode.window;
    if (!active_window)
        return null;
    for (var i = 0; i < warnings.length; i++) {
        // Do not "await" warning messages because the promise gets resolved only on warning dismissal.
        active_window.showWarningMessage('RBQL warning: ' + warnings[i]);
    }
    _unit_test_last_warnings = warnings;
}


async function handle_rbql_result_file(text_doc, warnings) {
    var out_delim = rbql_context.output_delim;
    let language_id = map_separator_to_language_id(out_delim);
    var active_window = vscode.window;
    if (!active_window)
        return;
    try {
        await active_window.showTextDocument(text_doc);
    } catch (error) {
        show_single_line_error('Unable to open RBQL result document');
        return;
    }
    if (language_id && text_doc.language_id != language_id) {
        console.log('changing RBQL result language ' + text_doc.language_id + ' -> ' + language_id);
        await vscode.languages.setTextDocumentLanguage(text_doc, language_id);
    }
    await show_warnings(warnings);
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


async function handle_command_result(src_table_path, dst_table_path, error_code, stdout, stderr, webview_report_handler) {
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
    // No need to close the RBQL console here, better to leave it open so it can be used to quickly adjust the query if needed.
    autodetection_stoplist.add(dst_table_path);
    result_set_parent_map.set(dst_table_path.toLowerCase(), src_table_path);
    let doc = await vscode.workspace.openTextDocument(dst_table_path);
    await handle_rbql_result_file(doc, warnings);
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
    let result_table_name = table_name + dst_extension;
    if (result_table_name == table_name) { // Just being paranoid to avoid overwriting input table accidentally when output dir configured to be the same as input.
        result_table_name += '.txt';
    }
    return result_table_name;
}


function file_path_to_query_key(file_path) {
    return (file_path && file_path.indexOf(scratch_buf_marker) != -1) ? scratch_buf_marker : file_path;
}

function get_dst_table_dir(input_table_path) {
    let rbql_output_dir = get_from_config('rbql_output_dir', 'TMP');
    if (rbql_output_dir == 'TMP') {
        return os.tmpdir();
    } else if (rbql_output_dir == 'INPUT') {
        return path.dirname(input_table_path);
    } else {
        // Return custom directory. If the directory does not exist or isn't writable RBQL itself will report more or less clear error.
        return rbql_output_dir;
    }
}


async function run_rbql_query(input_path, csv_encoding, backend_language, rbql_query, output_dialect, enable_rfc_newlines, with_headers, webview_report_handler) {
    last_rbql_queries.set(file_path_to_query_key(input_path), rbql_query);
    var cmd = 'python';
    const test_marker = 'test ';
    let close_and_error_guard = {'process_reported': false};

    let [input_delim, input_policy] = [rbql_context.delim, rbql_context.policy];
    if (input_policy == 'quoted' && enable_rfc_newlines)
        input_policy = 'quoted_rfc';
    let [output_delim, output_policy] = [input_delim, input_policy];
    if (output_dialect == 'csv')
        [output_delim, output_policy] = [',', 'quoted']; // XXX should it be "quoted_rfc" instead?
    if (output_dialect == 'tsv')
        [output_delim, output_policy] = ['\t', 'simple'];
    rbql_context.output_delim = output_delim;

    let output_path = is_web_ext ? null : path.join(get_dst_table_dir(input_path), get_dst_table_name(input_path, output_delim));

    if (rbql_query.startsWith(test_marker)) {
        if (rbql_query.indexOf('nopython') != -1) {
            cmd = 'nopython';
        }
        let args = [absolute_path_map['rbql mock/rbql_mock.py'], rbql_query];
        run_command(cmd, args, close_and_error_guard, function(error_code, stdout, stderr) { handle_command_result(input_path, output_path, error_code, stdout, stderr, webview_report_handler); });
        return;
    }
    if (backend_language == 'js') {
        let warnings = [];
        let result_doc = null;
        try {
            if (is_web_ext) {
                let result_lines = await ll_rainbow_utils().rbql_query_web(rbql_query, rbql_context.input_document, input_delim, input_policy, output_delim, output_policy, warnings, with_headers, null);
                let output_doc_cfg = {content: result_lines.join('\n'), language: map_separator_to_language_id(output_delim)};
                result_doc = await vscode.workspace.openTextDocument(output_doc_cfg);
            } else {
                let csv_options = {'bulk_read': true};
                await ll_rainbow_utils().rbql_query_node(global_state, rbql_query, input_path, input_delim, input_policy, output_path, output_delim, output_policy, csv_encoding, warnings, with_headers, null, '', csv_options);
                result_set_parent_map.set(output_path.toLowerCase(), input_path);
                autodetection_stoplist.add(output_path);
                result_doc = await vscode.workspace.openTextDocument(output_path);
            }
        } catch (e) {
            let [error_type, error_msg] = ll_rbql_csv().exception_to_error_info(e);
            webview_report_handler(error_type, error_msg);
            return;
        }
        webview_report_handler(null, null);
        await handle_rbql_result_file(result_doc, warnings);
    } else {
        if (is_web_ext) {
            webview_report_handler('Input error', 'Python backend for RBQL is not supported in web version, please use JavaScript backend.');
            return;
        }
        let cmd_safe_query = Buffer.from(rbql_query, "utf-8").toString("base64");
        let args = [absolute_path_map['rbql_core/vscode_rbql.py'], cmd_safe_query, input_path, input_delim, input_policy, output_path, output_delim, output_policy, csv_encoding];
        if (with_headers)
            args.push('--with_headers');
        run_command(cmd, args, close_and_error_guard, function(error_code, stdout, stderr) { handle_command_result(input_path, output_path, error_code, stdout, stderr, webview_report_handler); });
    }
}


function get_dialect(document) {
    var language_id = document.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return ['monocolumn', 'monocolumn'];
    return dialect_map[language_id];
}


async function set_header_line() {
    let active_editor = get_active_editor();
    if (!active_editor)
        return;
    var active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;

    var dialect = get_dialect(active_doc);
    var delim = dialect[0];
    var policy = dialect[1];
    if (policy == 'monocolumn') {
        show_single_line_error('Unable to set header line: no separator specified');
        return;
    }
    let file_path = active_doc.fileName;
    if (!file_path) {
        show_single_line_error('Unable to set header line for non-file documents');
        return;
    }
    let selection = active_editor.selection;
    let raw_header = active_doc.lineAt(selection.start.line).text;

    let header = csv_utils.smart_split(raw_header, delim, policy, false)[0];
    await save_to_global_state(make_header_key(file_path), JSON.stringify(header));
}


async function set_rainbow_separator() {
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

    let doc = await vscode.languages.setTextDocumentLanguage(active_doc, language_id);
    original_language_ids.set(doc.fileName, original_language_id);
    csv_lint(doc, false);
    refresh_status_bar_items(doc);
}


async function restore_original_language() {
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

    let doc = await vscode.languages.setTextDocumentLanguage(active_doc, original_language_id);
    original_language_ids.delete(file_path);
    refresh_status_bar_items(doc);
}


async function set_join_table_name() {
    if (is_web_ext) {
        show_single_line_error('This command is currently unavailable in web mode.');
        return;
    }
    var active_doc = get_active_doc();
    if (!active_doc)
        return;
    let file_path = active_doc.fileName;
    if (!file_path) {
        show_single_line_error('Unable to use this document as join table');
        return;
    }
    var title = "Input table name to use in RBQL JOIN expressions instead of table path";
    var input_box_props = {"prompt": title, "value": 'b'};
    let table_name = await vscode.window.showInputBox(input_box_props);
    if (!table_name)
        return; // User pressed Esc and closed the input box.
    save_to_global_state(ll_rainbow_utils().make_table_name_key(table_name), file_path);
}


async function set_virtual_header() {
    var active_doc = get_active_doc();
    var dialect = get_dialect(active_doc);
    var delim = dialect[0];
    var policy = dialect[1];
    var file_path = active_doc.fileName;
    if (!file_path) {
        show_single_line_error('Unable to edit column names for non-file documents');
        return;
    }
    if (policy == 'monocolumn') {
        show_single_line_error('Unable to set virtual header: no separator specified');
        return;
    }
    var old_header = get_header(active_doc, delim, policy);
    var title = "Adjust column names displayed in hover tooltips. Actual header line and file content won't be affected.";
    var old_header_str = quoted_join(old_header, delim);
    var input_box_props = {"prompt": title, "value": old_header_str};
    let raw_new_header = await vscode.window.showInputBox(input_box_props);
    if (!raw_new_header)
        return; // User pressed Esc and closed the input box.
    let new_header = csv_utils.smart_split(raw_new_header, delim, policy, false)[0];
    await save_to_global_state(make_header_key(file_path), JSON.stringify(new_header));
}


async function column_edit(edit_mode) {
    let active_editor = get_active_editor();
    if (!active_editor || !active_editor.selection)
        return;
    let active_doc = active_editor.document;
    if (!active_doc)
        return;
    let dialect = get_dialect(active_doc);
    let delim = dialect[0];
    let policy = dialect[1];
    let comment_prefix = get_from_config('comment_prefix', '');

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
    // Call showTextDocument so that the editor will gain focus and the cursors will become active and blinking. This is a critical step here!
    await vscode.window.showTextDocument(active_doc);
}


async function shrink_table() {
    let active_editor = get_active_editor();
    let active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    let language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    let [delim, policy] = dialect_map[language_id];
    let comment_prefix = get_from_config('comment_prefix', '');
    let progress_options = {location: vscode.ProgressLocation.Window, title: 'Rainbow CSV'};
    await vscode.window.withProgress(progress_options, async (progress) => {
        progress.report({message: 'Preparing'});
        await push_current_stack_to_js_callback_queue_to_allow_ui_update();
        let [shrinked_doc_text, first_failed_line] = ll_rainbow_utils().shrink_columns(active_doc, delim, policy, comment_prefix);
        if (first_failed_line) {
            show_single_line_error(`Unable to shrink: Inconsistent double quotes at line ${first_failed_line}`);
            return;
        }
        aligned_files.delete(active_doc.fileName);
        refresh_status_bar_items(active_doc);
        if (shrinked_doc_text === null) {
            vscode.window.showWarningMessage('No trailing whitespaces found, skipping');
            return;
        }
        progress.report({message: 'Shrinking columns'});
        await push_current_stack_to_js_callback_queue_to_allow_ui_update();
        await replace_doc_content(active_editor, active_doc, shrinked_doc_text);
    });
}


async function align_table() {
    let active_editor = get_active_editor();
    let active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    let language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    let [delim, policy] = dialect_map[language_id];
    let comment_prefix = get_from_config('comment_prefix', '');
    let progress_options = {location: vscode.ProgressLocation.Window, title: 'Rainbow CSV'};
    await vscode.window.withProgress(progress_options, async (progress) => {
        progress.report({message: 'Calculating column statistics'});
        await push_current_stack_to_js_callback_queue_to_allow_ui_update();
        let [column_stats, first_failed_line] = ll_rainbow_utils().calc_column_stats(active_doc, delim, policy, comment_prefix);
        if (first_failed_line) {
            show_single_line_error(`Unable to align: Inconsistent double quotes at line ${first_failed_line}`);
            return;
        }
        column_stats = ll_rainbow_utils().adjust_column_stats(column_stats);
        if (column_stats === null) {
            show_single_line_error('Unable to allign: Internal Rainbow CSV Error');
            return;
        }
        progress.report({message: 'Preparing final alignment'});
        await push_current_stack_to_js_callback_queue_to_allow_ui_update();
        let aligned_doc_text = ll_rainbow_utils().align_columns(active_doc, delim, policy, comment_prefix, column_stats);
        aligned_files.add(active_doc.fileName);
        refresh_status_bar_items(active_doc);
        if (aligned_doc_text === null) {
            vscode.window.showWarningMessage('Table is already aligned, skipping');
            return;
        }
        // The last stage of actually applying the edits takes almost 80% of the whole alignment runtime.
        progress.report({message: 'Aligning columns'});
        await push_current_stack_to_js_callback_queue_to_allow_ui_update();
        await replace_doc_content(active_editor, active_doc, aligned_doc_text);
    });
}


async function do_copy_back(query_result_doc, active_editor) {
    let data = query_result_doc.getText();
    let active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    await replace_doc_content(active_editor, active_doc, data);
}


async function copy_back() {
    if (is_web_ext) {
        show_single_line_error('This command is currently unavailable in web mode.');
        return;
    }
    let result_doc = get_active_doc();
    if (!result_doc)
        return;
    let file_path = result_doc.fileName;
    let parent_table_path = result_set_parent_map.get(file_path.toLowerCase());
    if (!parent_table_path)
        return;
    let parent_doc = await vscode.workspace.openTextDocument(parent_table_path);
    let parent_editor = await vscode.window.showTextDocument(parent_doc);
    await do_copy_back(result_doc, parent_editor);
}


async function update_query_history(query) {
    let history_list = get_from_global_state('rbql_query_history', []);
    let old_index = history_list.indexOf(query);
    if (old_index != -1) {
        history_list.splice(old_index, 1);
    } else if (history_list.length >= 20) {
        history_list.splice(0, 1);
    }
    history_list.push(query);
    await save_to_global_state('rbql_query_history', history_list);
}


async function handle_rbql_client_message(webview, message, integration_test_options=null) {
    let message_type = message['msg_type'];

    let webview_report_handler = async function(error_type, error_msg) {
        let report_msg = {'msg_type': 'rbql_report'};
        if (error_type)
            report_msg["error_type"] = error_type;
        if (error_msg)
            report_msg["error_msg"] = error_msg;
        _unit_test_last_rbql_report = report_msg;
        await webview.postMessage(report_msg);
    };

    if (message_type == 'handshake') {
        var backend_language = get_from_global_state('rbql_backend_language', 'js');
        var encoding = get_from_global_state('rbql_encoding', 'utf-8');
        var init_msg = {'msg_type': 'handshake', 'backend_language': backend_language, 'encoding': encoding};
        sample_preview_records_from_context(rbql_context, init_msg);
        let path_key = file_path_to_query_key(rbql_context.input_document_path);
        if (last_rbql_queries.has(path_key))
            init_msg['last_query'] = last_rbql_queries.get(path_key);
        let history_list = get_from_global_state('rbql_query_history', []);
        init_msg['query_history'] = history_list;
        init_msg['policy'] = rbql_context.policy;
        init_msg['enable_rfc_newlines'] = rbql_context.enable_rfc_newlines;
        init_msg['with_headers'] = rbql_context.with_headers;
        init_msg['header'] = rbql_context.header;
        init_msg['is_web_ext'] = is_web_ext;
        if (integration_test_options) {
            init_msg['integration_test_language'] = integration_test_options.rbql_backend;
            init_msg['integration_test_query'] = integration_test_options.rbql_query;
            init_msg['integration_test_with_headers'] = integration_test_options.with_headers || false;
            init_msg['integration_test_enable_rfc_newlines'] = integration_test_options.enable_rfc_newlines || false;
        }
        await webview.postMessage(init_msg);
    }

    if (message_type == 'fetch_table_header') {
        try {
            let table_id = message['table_id'];
            let encoding = message['encoding'];

            let input_table_dir = rbql_context.input_document_path ? path.dirname(rbql_context.input_document_path) : null;
            let table_path = ll_rainbow_utils().find_table_path(global_state, input_table_dir, table_id);
            if (!table_path)
                return;
            let header_line = await ll_rainbow_utils().read_header(table_path, encoding);
            let [fields, warning] = csv_utils.smart_split(header_line, rbql_context.delim, rbql_context.policy, false);
            if (!warning) {
                webview.postMessage({'msg_type': 'fetch_table_header_response', 'header': fields});
            }
        } catch (e) {
            console.error('Unable to get join table header: ' + String(e));
        }
    }

    if (message_type == 'update_query') {
        let rbql_query = message['query'];
        if (!rbql_query)
            return;
        if (rbql_context.input_document_path)
            last_rbql_queries.set(file_path_to_query_key(rbql_context.input_document_path), rbql_query);
    }

    if (message_type == 'newlines_policy_change') {
        rbql_context.enable_rfc_newlines = message['enable_rfc_newlines'];
        if (rbql_context.input_document_path)
            await save_to_global_state(make_rfc_policy_key(rbql_context.input_document_path), rbql_context.enable_rfc_newlines);
        let protocol_message = {'msg_type': 'resample'};
        sample_preview_records_from_context(rbql_context, protocol_message);
        await webview.postMessage(protocol_message);
    }

    if (message_type == 'with_headers_change') {
        rbql_context.with_headers = message['with_headers'];
        if (rbql_context.input_document_path)
            await save_to_global_state(make_with_headers_key(rbql_context.input_document_path), rbql_context.with_headers);
    }

    if (message_type == 'navigate') {
        var navig_direction = message['direction'];
        if (navig_direction == 'backward') {
            rbql_context.requested_start_record -= preview_window_size;
        } else if (navig_direction == 'forward') {
            rbql_context.requested_start_record += preview_window_size;
        } else if (navig_direction == 'begin') {
            rbql_context.requested_start_record = 0;
        } else if (navig_direction == 'end') {
            rbql_context.requested_start_record = rbql_context.input_document.lineCount; // This is just max possible value which is incorrect and will be adjusted later.
        }
        let protocol_message = {'msg_type': 'navigate'};
        sample_preview_records_from_context(rbql_context, protocol_message);
        await webview.postMessage(protocol_message);
    }

    if (message_type == 'run') {
        let rbql_query = message['query'];
        let backend_language = message['backend_language'];
        let encoding = message['encoding'];
        let output_dialect = message['output_dialect'];
        let enable_rfc_newlines = message['enable_rfc_newlines'];
        let with_headers = message['with_headers'];
        await update_query_history(rbql_query);
        await run_rbql_query(rbql_context.input_document_path, encoding, backend_language, rbql_query, output_dialect, enable_rfc_newlines, with_headers, webview_report_handler);
    }

    if (message_type == 'edit_udf') {
        if (is_web_ext) {
            webview_report_handler('Input error', 'UDFs are currently not supported in web version');
            return;
        }
        let backend_language = message['backend_language'];
        let udf_file_path = null;
        let default_content = '';
        if (backend_language == 'js') {
            udf_file_path = path.join(os.homedir(), '.rbql_init_source.js');
            default_content = ll_rainbow_utils().get_default_js_udf_content();
        } else {
            udf_file_path = path.join(os.homedir(), '.rbql_init_source.py');
            default_content = ll_rainbow_utils().get_default_python_udf_content();
        }
        if (!fs.existsSync(udf_file_path)) {
            fs.writeFileSync(udf_file_path, default_content);
        }
        let udf_doc = await vscode.workspace.openTextDocument(udf_file_path);
        await vscode.window.showTextDocument(udf_doc);
    }

    if (message_type == 'global_param_change') {
        await save_to_global_state(message['key'], message['value']);
    }
}


function adjust_webview_paths(paths_list, client_html) {
    for (const local_path of paths_list) {
        let adjusted_webview_url = null;
        if (is_web_ext) {
            adjusted_webview_url = absolute_path_map[local_path];
        } else {
            adjusted_webview_url = preview_panel.webview.asWebviewUri(vscode.Uri.file(absolute_path_map[local_path]));
        }
        client_html = client_html.replace(`src="${local_path}"`, `src="${adjusted_webview_url}"`);
    }
    return client_html;
}


async function edit_rbql(integration_test_options=null) {
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
    if (!orig_uri)
        return;
    // For web orig_uri.scheme can have other valid values e.g. `vscode-test-web` when testing the browser integration.
    if (orig_uri.scheme != 'file' && orig_uri.scheme != 'untitled' && !is_web_ext)
        return;
    if (orig_uri.scheme == 'file' && active_doc.isDirty && !is_web_ext) {
        show_single_line_error("Unable to run RBQL: file has unsaved changes");
        return;
    }
    let input_path = null;
    if (orig_uri.scheme == 'untitled' && !is_web_ext) {
        // Scheme 'untitled' means that the document is a scratch buffer that hasn't been saved yet, see https://code.visualstudio.com/api/references/document-selector
        let data = active_doc.getText();
        let rnd_suffix = String(Math.floor(Math.random() * 1000000));
        input_path = path.join(os.tmpdir(), `${scratch_buf_marker}_${rnd_suffix}.txt`);
        // TODO consider adding username to the input_path and using chmod 600 on it.
        fs.writeFileSync(input_path, data);
    } else {
        input_path = active_doc.fileName;
    }

    if (!input_path) {
        show_single_line_error("Unable to run RBQL for this file");
        return;
    }
    let language_id = active_doc.languageId;
    let delim = 'monocolumn';
    let policy = 'monocolumn';
    if (dialect_map.hasOwnProperty(language_id)) {
        [delim, policy] = dialect_map[language_id];
    }
    let enable_rfc_newlines = get_from_global_state(make_rfc_policy_key(input_path), false);
    let with_headers_by_default = get_from_config('rbql_with_headers_by_default', false);
    let with_headers = get_from_global_state(make_with_headers_key(input_path), with_headers_by_default);
    let header = get_header_from_document(active_doc, delim, policy);
    rbql_context = {
        "input_document": active_doc,
        "input_document_path": input_path,
        "requested_start_record": 0,
        "delim": delim,
        "policy": policy,
        "rfc_record_map": [],
        "enable_rfc_newlines": enable_rfc_newlines,
        "with_headers": with_headers,
        "header": header
    };

    preview_panel = vscode.window.createWebviewPanel('rbql-console', 'RBQL Console', vscode.ViewColumn.Active, {enableScripts: true});
    if (!client_html_template) {
        if (is_web_ext) {
            client_html_template = client_html_template_web;
        } else {
            client_html_template = fs.readFileSync(absolute_path_map['rbql_client.html'], "utf8");
        }
    }
    let client_html = client_html_template;
    client_html = adjust_webview_paths(['contrib/textarea-caret-position/index.js', 'rbql_suggest.js', 'rbql_client.js', 'rbql_logo.svg'], client_html);
    preview_panel.webview.html = client_html;
    preview_panel.webview.onDidReceiveMessage(function(message) { handle_rbql_client_message(preview_panel.webview, message, integration_test_options); });
}


function get_num_columns_if_delimited(active_doc, delim, policy, min_num_columns, min_num_lines) {
    var num_lines = active_doc.lineCount;
    let num_fields = 0;
    let num_lines_checked = 0;
    let comment_prefix_for_autodetection = get_from_config('comment_prefix', '');
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
    let min_num_lines = get_from_config('autodetection_min_line_count', 10);
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
            continue; // Whitespace and dot have advantage over other separators in this algorithm, so we just skip them.
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


async function autoenable_rainbow_csv(active_doc) {
    if (!active_doc)
        return active_doc;
    if (!get_from_config('enable_separator_autodetection', false))
        return active_doc;
    let candidate_separators = get_from_config('autodetect_separators', []);
    var original_language_id = active_doc.languageId;
    var file_path = active_doc.fileName;
    if (!file_path || autodetection_stoplist.has(file_path)) {
        return active_doc;
    }
    let is_default_csv = file_path.endsWith('.csv') && original_language_id == 'csv';
    if (original_language_id != 'plaintext' && !is_default_csv)
        return active_doc;
    let rainbow_csv_language_id = autodetect_dialect(active_doc, candidate_separators);
    if (!rainbow_csv_language_id && is_default_csv) {
        // Smart autodetection method has failed, but we need to choose a separator because this is a csv file. Let's just find the most popular one.
        rainbow_csv_language_id = autodetect_dialect_frequency_based(active_doc, candidate_separators);
    }
    if (!rainbow_csv_language_id || rainbow_csv_language_id == original_language_id)
        return active_doc;

    let doc = await vscode.languages.setTextDocumentLanguage(active_doc, rainbow_csv_language_id);
    original_language_ids.set(file_path, original_language_id);
    return doc;
}


async function handle_first_empty_doc_edit(change_event) {
    if (!change_event)
        return;
    if (doc_edit_subscription) {
        doc_edit_subscription.dispose();
        doc_edit_subscription = null;
    }
    let active_doc = change_event.document;
    if (!active_doc)
        return;
    let candidate_separators = get_from_config('autodetect_separators', []);
    let rainbow_csv_language_id = autodetect_dialect(active_doc, candidate_separators);
    if (!rainbow_csv_language_id)
        return;
    let doc = await vscode.languages.setTextDocumentLanguage(active_doc, rainbow_csv_language_id);
    csv_lint(doc, false);
    refresh_status_bar_items(doc);
}


function register_csv_copy_paste_for_empty_doc(active_doc) {
    if (!get_from_config('enable_separator_autodetection', false))
        return;
    if (!active_doc || doc_edit_subscription)
        return;
    if (!active_doc.isUntitled && active_doc.lineCount != 0)
        return;
    doc_edit_subscription = vscode.workspace.onDidChangeTextDocument(handle_first_empty_doc_edit);
    return;
}


function handle_editor_switch(editor) {
    let active_doc = get_active_doc(editor);
    csv_lint(active_doc, false);
    // Calling `refresh_status_bar_items` is required for non-csv documents too to ensure that they have csv-related status items cleared.
    refresh_status_bar_items(active_doc);
}


function do_handle_cursor_movement() {
    if (!show_column_info_button())
        column_info_button.hide();
}


function handle_cursor_movement(_unused_cursor_event) {
    if (cursor_timeout_handle !== null) {
        clearTimeout(cursor_timeout_handle);
    }
    // We need timeout delay here to deduplicate/debounce events from multiple consecutive movements, see https://stackoverflow.com/a/49050990/2898283.
    cursor_timeout_handle = setTimeout(() => do_handle_cursor_movement(), 10);
}


async function handle_doc_open(active_doc) {
    register_csv_copy_paste_for_empty_doc(active_doc);
    active_doc = await autoenable_rainbow_csv(active_doc);
    csv_lint(active_doc, false);
    refresh_status_bar_items(active_doc);
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


async function make_preview(uri, preview_mode) {
    if (is_web_ext) {
        show_single_line_error('This command is currently unavailable in web mode.');
        return;
    }
    var file_path = uri.fsPath;
    if (!file_path || !fs.existsSync(file_path)) {
        vscode.window.showErrorMessage('Invalid file');
        return;
    }

    var size_limit = 1024000; // ~1MB
    var file_size_in_bytes = fs.statSync(file_path)['size'];
    if (file_size_in_bytes <= size_limit) {
        vscode.window.showWarningMessage('Rainbow CSV: The file is not big enough, showing the full file instead. Use this preview for files larger than 1MB');
        let full_orig_doc = await vscode.workspace.openTextDocument(file_path);
        await vscode.window.showTextDocument(full_orig_doc);
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
            // TODO handle old mac '\r' line endings - still used by Mac version of Excel.
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


async function activate(context) {
    // TODO consider storing `context` itself in a global variable.
    global_state = context.globalState;

    if (is_web_ext) {
        let rbql_client_uri = vscode.Uri.joinPath(context.extensionUri, 'rbql_client.html');
        let bytes = await vscode.workspace.fs.readFile(rbql_client_uri);
        // Using TextDecoder because it should work fine in web extension.
        client_html_template_web = new TextDecoder().decode(bytes);
    }

    for (let local_path in absolute_path_map) {
        if (absolute_path_map.hasOwnProperty(local_path)) {
            if (is_web_ext) {
                absolute_path_map[local_path] = vscode.Uri.joinPath(context.extensionUri, local_path);
            } else {
                absolute_path_map[local_path] = context.asAbsolutePath(local_path);
            }
        }
    }

    if (get_from_config('enable_tooltip', false)) {
        for (let language_id in dialect_map) {
            if (dialect_map.hasOwnProperty(language_id)) {
                register_csv_hover_info_provider(language_id, context);
            }
        }
    }

    var lint_cmd = vscode.commands.registerCommand('rainbow-csv.CSVLint', csv_lint_cmd);
    var rbql_cmd = vscode.commands.registerCommand('rainbow-csv.RBQL', edit_rbql);
    var set_header_line_cmd = vscode.commands.registerCommand('rainbow-csv.SetHeaderLine', set_header_line);
    var edit_column_names_cmd = vscode.commands.registerCommand('rainbow-csv.SetVirtualHeader', set_virtual_header);
    var set_join_table_name_cmd = vscode.commands.registerCommand('rainbow-csv.SetJoinTableName', set_join_table_name); // WEB_DISABLED
    var column_edit_before_cmd = vscode.commands.registerCommand('rainbow-csv.ColumnEditBefore', async function() { await column_edit('ce_before'); });
    var column_edit_after_cmd = vscode.commands.registerCommand('rainbow-csv.ColumnEditAfter', async function() { await column_edit('ce_after'); });
    var column_edit_select_cmd = vscode.commands.registerCommand('rainbow-csv.ColumnEditSelect', async function() { await column_edit('ce_select'); });
    var set_separator_cmd = vscode.commands.registerCommand('rainbow-csv.RainbowSeparator', set_rainbow_separator);
    var rainbow_off_cmd = vscode.commands.registerCommand('rainbow-csv.RainbowSeparatorOff', restore_original_language);
    var sample_head_cmd = vscode.commands.registerCommand('rainbow-csv.SampleHead', async function(uri) { await make_preview(uri, 'head'); }); // WEB_DISABLED
    var sample_tail_cmd = vscode.commands.registerCommand('rainbow-csv.SampleTail', async function(uri) { await make_preview(uri, 'tail'); }); // WEB_DISABLED
    var align_cmd = vscode.commands.registerCommand('rainbow-csv.Align', align_table);
    var shrink_cmd = vscode.commands.registerCommand('rainbow-csv.Shrink', shrink_table);
    var copy_back_cmd = vscode.commands.registerCommand('rainbow-csv.CopyBack', copy_back); // WEB_DISABLED
    var internal_test_cmd = vscode.commands.registerCommand('rainbow-csv.InternalTest', run_internal_test_cmd);

    var doc_open_event = vscode.workspace.onDidOpenTextDocument(handle_doc_open);
    var switch_event = vscode.window.onDidChangeActiveTextEditor(handle_editor_switch);

    // The only purpose to add the entries to context.subscriptions is to guarantee their disposal during extension deactivation
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
    context.subscriptions.push(set_header_line_cmd);
    context.subscriptions.push(internal_test_cmd);

    // Need this because "onDidOpenTextDocument()" doesn't get called for the first open document.
    // Another issue is when dev debug logging mode is enabled, the first document would be "Log" because it is printing something and gets VSCode focus.
    await sleep(1000);
    let active_doc = get_active_doc();
    handle_doc_open(active_doc);
}


function deactivate() {
    // This method is called when extension is deactivated.
}


exports.activate = activate;
exports.deactivate = deactivate;
