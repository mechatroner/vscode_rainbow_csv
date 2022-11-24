const vscode = require('vscode');

const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');

const fast_load_utils = require('./fast_load_utils.js');

// Please see DEV_README.md file for additional info.
// FIXME add an updated README.md RBQL screenshot.

const csv_utils = require('./rbql_core/rbql-js/csv_utils.js');

var rbql_csv = null; // Using lazy load to improve startup performance.
function ll_rbql_csv() {
    if (rbql_csv === null)
        rbql_csv = require('./rbql_core/rbql-js/rbql_csv.js');
    return rbql_csv;
}


var rainbow_utils = null; // Using lazy load to improve startup performance.
function ll_rainbow_utils() {
    if (rainbow_utils === null) {
        rainbow_utils = require('./rainbow_utils.js');
    }
    return rainbow_utils;
}


const is_web_ext = (os.homedir === undefined); // Runs as web extension in browser.
const preview_window_size = 100;
const scratch_buf_marker = 'vscode_rbql_scratch';
const dynamic_csv_highlight_margin = 50; // TODO make configurable

let client_html_template_web = null;

var aligned_files = new Set();
var result_set_parent_map = new Map();
var cached_table_parse_result = new Map(); // TODO store doc timestamp / size to invalidate the entry when the doc changes.
var manual_comment_prefix_stoplist = new Set();

var rbql_status_bar_button = null;
var align_shrink_button = null;
var rainbow_off_status_bar_button = null;
var copy_back_button = null;
var column_info_button = null;
var dynamic_dialect_select_button = null;

var rbql_context = null;

var last_rbql_queries = new Map(); // Query history does not replace this structure, it is also used to store partially entered queries for preview window switch.

var client_html_template = null;

var global_state = null;

var preview_panel = null;

var doc_first_edit_subscription = null;
var keyboard_cursor_subscription = null;

var _unit_test_last_rbql_report = null; // For unit tests only.
var _unit_test_last_warnings = null; // For unit tests only.

let cursor_timeout_handle = null;

let rainbow_token_event = null;
let comment_token_event = null;

const DYNAMIC_CSV = 'dynamic csv';

const QUOTED_POLICY = 'quoted';
const WHITESPACE_POLICY = 'whitespace';
const QUOTED_RFC_POLICY = 'quoted_rfc';
const SIMPLE_POLICY = 'simple';


let extension_context = {
    lint_results: new Map(),
    lint_status_bar_button: null,
    dynamic_document_dialects: new Map(),
    custom_comment_prefixes: new Map(),
    original_language_ids: new Map(),
    autodetection_stoplist: new Set(),
    autodetection_temporarily_disabled_for_rbql: false,
    dynamic_dialect_for_next_request: null,
};

const dialect_map = {
    'csv': [',', QUOTED_POLICY],
    'tsv': ['\t', SIMPLE_POLICY],
    'csv (semicolon)': [';', QUOTED_POLICY],
    'csv (pipe)': ['|', SIMPLE_POLICY],
    'csv (whitespace)': [' ', WHITESPACE_POLICY],
    [DYNAMIC_CSV]: [null, null]
};

const tokenTypes = ['rainbow1', 'macro', 'function', 'comment', 'string', 'parameter', 'type', 'enumMember', 'keyword', 'regexp'];
const tokens_legend = new vscode.SemanticTokensLegend(tokenTypes);


function safe_lower(src_str) {
    if (!src_str)
        return src_str;
    return src_str.toLowerCase();
}


function get_default_policy(separator) {
    // This function is most likely a temporal workaround, get rid of it when possible.
    for (let language_id in dialect_map) {
        if (!dialect_map.hasOwnProperty(language_id))
            continue;
        if (dialect_map[language_id][0] == separator)
            return dialect_map[language_id][1];
    }
    return SIMPLE_POLICY;
}


function map_dialect_to_language_id(separator, policy) {
    for (let language_id in dialect_map) {
        if (!dialect_map.hasOwnProperty(language_id))
            continue;
        if (dialect_map[language_id][0] == separator && dialect_map[language_id][1] == policy)
            return language_id;
    }
    return DYNAMIC_CSV;
}


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


async function replace_doc_content(active_editor, active_doc, new_content) {
    let invalid_range = new vscode.Range(0, 0, active_doc.lineCount /* Intentionally missing the '-1' */, 0);
    let full_range = active_doc.validateRange(invalid_range);
    await active_editor.edit(edit => edit.replace(full_range, new_content));
}


function make_header_key(file_path) {
    return 'rbql_header:' + file_path;
}


function make_with_headers_key(file_path) {
    return 'rbql_with_headers:' + file_path;
}


function get_from_config(param_name, default_value, config=null) {
    if (!config) {
        config = vscode.workspace.getConfiguration('rainbow_csv');
    }
    return config ? config.get(param_name) : default_value;
}


function get_header_from_document(document, delim, policy, comment_prefix) {
    let header_line = ll_rainbow_utils().get_header_line(document, comment_prefix);
    return csv_utils.smart_split(header_line, delim, policy, /*preserve_quotes_and_whitespaces=*/false)[0];
}


function get_header(document, delim, policy, comment_prefix) {
    var file_path = document.fileName;
    if (file_path) {
        let raw_header = get_from_global_state(make_header_key(file_path), null);
        if (raw_header) {
            return JSON.parse(raw_header);
        }
    }
    return get_header_from_document(document, delim, policy, comment_prefix);
}


function get_dialect(document) {
    let language_id = document.languageId;
    let delim = null;
    let policy = null;

    let comment_prefix = '';
    if (extension_context.custom_comment_prefixes.has(document.fileName)) {
        comment_prefix = extension_context.custom_comment_prefixes.get(document.fileName);
    } else {
        comment_prefix = get_from_config('comment_prefix', '');
    }
    if (language_id != DYNAMIC_CSV && dialect_map.hasOwnProperty(language_id)) {
        [delim, policy] = dialect_map[language_id];
        return [delim, policy, comment_prefix];
    }
    // Here we don't check if language_id is DYNAMIC_CSV because we want to return the once selected dialect anyway even if file is now 'plaintext' or some other non-csv filetype.
    if (extension_context.dynamic_document_dialects.has(document.fileName)) {
        let dialect_info = extension_context.dynamic_document_dialects.get(document.fileName);
        delim = dialect_info.delim;
        policy = dialect_info.policy;
        return [delim, policy, comment_prefix];
    }
    // The language id can be `dynamic csv` here e.g. if user just now manually selected the "Dynamic CSV" filetype.
    return [null, null, null];
}


function show_status_bar_items(active_doc) {
    if (dynamic_dialect_select_button) {
        dynamic_dialect_select_button.hide();
    }
    ll_rainbow_utils().show_lint_status_bar_button(vscode, extension_context, active_doc.fileName, active_doc.languageId);
    show_rbql_status_bar_button();
    show_align_shrink_button(active_doc.fileName);
    show_rainbow_off_status_bar_button();
    show_rbql_copy_to_source_button(active_doc.fileName);
    show_column_info_button(); // This function finds active_doc internally, but the possible inconsistency is harmless.
}


function enable_dynamic_semantic_tokenization() {
    let token_provider = new RainbowTokenProvider();
    if (rainbow_token_event !== null) {
        rainbow_token_event.dispose();
    }
    let document_selector = { language: DYNAMIC_CSV }; // Use '*' to select all languages if needed.
    rainbow_token_event = vscode.languages.registerDocumentRangeSemanticTokensProvider(document_selector, token_provider, tokens_legend);
}


function register_comment_tokenization_handler() {
    let token_provider = new CommentTokenProvider();
    if (comment_token_event !== null) {
        comment_token_event.dispose();
    }
    let document_selector = [];
    for (let language_id in dialect_map) {
        if (dialect_map.hasOwnProperty(language_id) && language_id != DYNAMIC_CSV) {
            // We skip DYNAMIC_CSV here because its provider already handles comment lines.
            document_selector.push({language: language_id});
        }
    }
    comment_token_event = vscode.languages.registerDocumentRangeSemanticTokensProvider(document_selector, token_provider, tokens_legend);
}


async function get_dialect_from_user_dialog() {
    let title = "Select separator character or string e.g. `,` or `:=`. For tab use `TAB`";
    let input_box_props = {"prompt": title, "value": ','};
    let delim = await vscode.window.showInputBox(input_box_props);
    if (!delim) {
        return [null, null];
    }
    let policy = (delim == ',' || delim == ';') ? QUOTED_RFC_POLICY : SIMPLE_POLICY;
    return [delim, policy];
}


async function choose_dynamic_separator() {
    let active_doc = get_active_doc();
    if (active_doc.languageId != DYNAMIC_CSV) {
        show_single_line_error('Dynamic separator can only be adjusted for "Dynamic CSV" filetype.');
        return;
    }
    let [delim, policy] = await get_dialect_from_user_dialog();
    if (!delim) {
        show_single_line_error('Unable to use empty string separator');
        return;
    }
    extension_context.dynamic_document_dialects.set(active_doc.fileName, {delim: delim, policy: policy});
    await enable_rainbow_features_if_csv(active_doc);
}


function show_choose_dynamic_separator_button() {
    if (!dynamic_dialect_select_button)
        dynamic_dialect_select_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    dynamic_dialect_select_button.text = 'Choose Separator...';
    dynamic_dialect_select_button.tooltip = 'Click to choose Dynamic CSV separator';
    dynamic_dialect_select_button.command = 'rainbow-csv.ChooseDynamicSeparator';
    dynamic_dialect_select_button.show();
}


async function enable_rainbow_features_if_csv(active_doc) {
    let file_path = active_doc ? active_doc.fileName : null;
    if (!active_doc || !file_path || file_path.endsWith('.git')) {
        // For new untitled scratch documents `file_path` would be "Untitled-1", "Untitled-2", etc, so we won't enter this branch.
        // Sometimes for git-controlled dirs VSCode opens mysterious .git files - skip them.
        return;
    }
    var language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id)) {
        return;
    }
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (!policy && extension_context.dynamic_dialect_for_next_request != null) {
        [delim, policy] = extension_context.dynamic_dialect_for_next_request;
        extension_context.dynamic_document_dialects.set(file_path, {delim: delim, policy: policy});
        extension_context.dynamic_dialect_for_next_request = null;
        [delim, policy, comment_prefix] = get_dialect(active_doc);
    }
    if (!policy) {
        if (language_id == DYNAMIC_CSV) {
            [delim, policy] = await get_dialect_from_user_dialog();
            if (!policy) {
                // Last attempt: retry getting dialect, because it can be set asynchronously: after opening the (which would trigger enable_rainbow_features_if_csv in the end) the caller could update dynamic_document_dialects for example this happens in RBQL queries handling.
                [delim, policy, comment_prefix] = get_dialect(active_doc);
            }
            if (!policy) {
                hide_buttons(); // Hide buttons when switching "csv" -> "dynamic csv".
                show_choose_dynamic_separator_button();
                return;
            }
            extension_context.dynamic_document_dialects.set(file_path, {delim: delim, policy: policy});
        } else {
            return;
        }
    }
    if (!delim) {
        return; // Adding this condition JIC, this should never happen at this point - we would return earlier if there were no policy (hence no delim).
    }
    if (get_from_config('enable_cursor_position_info', false)) {
        keyboard_cursor_subscription = vscode.window.onDidChangeTextEditorSelection(handle_cursor_movement);
    }
    if (comment_prefix) {
        // It is currently impoossible to set comment_prefix on document level, so we have to set it on language level instead.
        // This could potentially cause minor problems in very rare situations.
        // Applying 'setLanguageConfiguration' doesn't disable static configuration in language-configuration.json.
        vscode.languages.setLanguageConfiguration(language_id, { comments: { lineComment: comment_prefix } });
    }

    if (language_id == DYNAMIC_CSV) {
        // Re-enable tokenization to explicitly trigger the highligthing. Sometimes this doesn't happen automatically.
        enable_dynamic_semantic_tokenization();
    }
    show_status_bar_items(active_doc);
    await csv_lint(active_doc, false);
}


function hide_buttons() {
    let all_buttons = [extension_context.lint_status_bar_button, rbql_status_bar_button, rainbow_off_status_bar_button, copy_back_button, align_shrink_button, column_info_button, dynamic_dialect_select_button];
    for (let i = 0; i < all_buttons.length; i++) {
        if (all_buttons[i])
            all_buttons[i].hide();
    }
}


function disable_rainbow_features_if_non_csv(active_doc) {
    let file_path = active_doc ? active_doc.fileName : null;
    if (!active_doc) {
        // This can happen when openning settings tab for example.
        hide_buttons();
        return;
    }
    if (file_path && file_path.endsWith('.git')) {
        // Sometimes for git-controlled dirs VSCode opens mysterious .git files which are not even present - skip them, don't disable features.
        return;
    }
    var language_id = active_doc.languageId;
    if (dialect_map.hasOwnProperty(language_id))
        return;
    hide_buttons();
    if (keyboard_cursor_subscription) {
        keyboard_cursor_subscription.dispose();
        keyboard_cursor_subscription = null;
    }
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


function do_show_column_info_button(full_report, short_report) {
    if (!column_info_button)
        column_info_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    column_info_button.text = short_report;
    column_info_button.tooltip = full_report;
    column_info_button.show();
}


function make_hover(document, language_id, position, cancellation_token) {
    if (!get_from_config('enable_tooltip', false)) {
        return;
    }
    let [delim, policy, comment_prefix] = get_dialect(document);
    let cursor_position_info = ll_rainbow_utils().get_cursor_position_info(vscode, document, delim, policy, comment_prefix, position);
    if (!cursor_position_info || cancellation_token.isCancellationRequested)
        return null;
    let enable_tooltip_column_names = get_from_config('enable_tooltip_column_names', false);
    let header = get_header(document, delim, policy, comment_prefix);
    let [_full_text, short_report] = ll_rainbow_utils().format_cursor_position_info(cursor_position_info, header, enable_tooltip_column_names, /*show_comments=*/true, /*max_label_length=*/25);
    let mds = null;
    if (language_id == DYNAMIC_CSV) {
        mds = short_report; // Do not colorize hover text because dynamic csv provides inconsistent colors for some of the tokens.
    } else {
        mds = new vscode.MarkdownString();
        mds.appendCodeblock(short_report, 'rainbow hover markup');
    }
    return new vscode.Hover(mds);
}


function show_column_info_button() {
    let active_editor = get_active_editor();
    if (!active_editor) {
        return false;
    }
    let position = ll_rainbow_utils().get_cursor_position_if_unambiguous(active_editor);
    if (!position) {
        return false;
    }
    let active_doc = get_active_doc(active_editor);
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    let cursor_position_info = ll_rainbow_utils().get_cursor_position_info(vscode, active_doc, delim, policy, comment_prefix, position);
    if (!cursor_position_info)
        return false;
    let enable_tooltip_column_names = get_from_config('enable_tooltip_column_names', false);
    let header = get_header(active_doc, delim, policy, comment_prefix);
    let [full_report, short_report] = ll_rainbow_utils().format_cursor_position_info(cursor_position_info, header, enable_tooltip_column_names, /*show_comments=*/false, /*max_label_length=*/25);
    do_show_column_info_button(full_report, short_report);
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


function show_rbql_copy_to_source_button(file_path) {
    let parent_table_path = result_set_parent_map.get(safe_lower(file_path));
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


async function csv_lint(active_doc, is_manual_op) {
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
        if (extension_context.lint_results.has(lint_cache_key))
            return null;
        if (!get_from_config('enable_auto_csv_lint', false))
            return null;
    }
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (policy === null)
        return null;
    extension_context.lint_results.set(lint_cache_key, {is_processing: true});
    ll_rainbow_utils().show_lint_status_bar_button(vscode, extension_context, file_path, language_id); // Visual feedback.
    let detect_trailing_spaces = get_from_config('csv_lint_detect_trailing_spaces', false);
    let [_records, _num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, _comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/false, /*preserve_quotes_and_whitespaces=*/true, detect_trailing_spaces);
    let is_ok = (first_defective_line === null && fields_info.size <= 1);
    let lint_result = {'is_ok': is_ok, 'first_defective_line': first_defective_line, 'fields_info': fields_info, 'first_trailing_space_line': first_trailing_space_line};
    extension_context.lint_results.set(lint_cache_key, lint_result);
    if (is_manual_op) {
        // Need timeout here to give user enough time to notice green -> yellow -> green switch, this is a sort of visual feedback.
        await sleep(500);
    }
    ll_rainbow_utils().show_lint_status_bar_button(vscode, extension_context, file_path, language_id); // Visual feedback.
    return lint_result;
}


async function csv_lint_cmd() {
    // TODO re-run on each file save with content change.
    let lint_report_for_unit_tests = await csv_lint(null, true);
    return lint_report_for_unit_tests;
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


async function handle_rbql_result_file_node(text_doc, delim, policy, warnings) {
    try {
        await vscode.window.showTextDocument(text_doc);
    } catch (error) {
        show_single_line_error('Unable to open RBQL result document');
        return;
    }
    let language_id = map_dialect_to_language_id(delim, policy);
    if (language_id && text_doc.languageId != language_id) {
        // In non-web version we open a new doc without preset filetype, so we need to manually set it.
        await vscode.languages.setTextDocumentLanguage(text_doc, language_id);
    }
    await show_warnings(warnings);
}


async function handle_rbql_result_file_web(text_doc, warnings) {
    try {
        await vscode.window.showTextDocument(text_doc);
    } catch (error) {
        show_single_line_error('Unable to open RBQL result document');
        return;
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


async function handle_command_result(src_table_path, dst_table_path, dst_delim, dst_policy, error_code, stdout, stderr, webview_report_handler) {
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
    extension_context.autodetection_stoplist.add(dst_table_path);
    result_set_parent_map.set(safe_lower(dst_table_path), src_table_path);
    extension_context.autodetection_temporarily_disabled_for_rbql = true;
    let target_language_id = map_dialect_to_language_id(dst_delim, dst_policy);
    let doc = await vscode.workspace.openTextDocument(dst_table_path);
    extension_context.autodetection_temporarily_disabled_for_rbql = false;
    if (target_language_id == DYNAMIC_CSV) {
        // TODO it would be better to set this before openTextDocument and adjust the logic so this would affect autodetection.
        extension_context.dynamic_dialect_for_next_request = [dst_delim, dst_policy];
    }
    await handle_rbql_result_file_node(doc, dst_delim, dst_policy, warnings);
    extension_context.dynamic_dialect_for_next_request = null;
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


async function run_rbql_query(input_path, csv_encoding, backend_language, rbql_query, output_dialect, with_headers, webview_report_handler) {
    last_rbql_queries.set(file_path_to_query_key(input_path), rbql_query);
    var cmd = 'python';
    const test_marker = 'test ';
    let close_and_error_guard = {'process_reported': false};

    let [input_delim, input_policy, comment_prefix] = [rbql_context.delim, rbql_context.policy, rbql_context.comment_prefix];
    let [output_delim, output_policy] = [input_delim, input_policy];
    if (output_dialect == 'csv')
        [output_delim, output_policy] = [',', QUOTED_POLICY];
    if (output_dialect == 'tsv')
        [output_delim, output_policy] = ['\t', SIMPLE_POLICY];
    rbql_context.output_delim = output_delim;
    rbql_context.output_policy = output_policy;

    let output_path = is_web_ext ? null : path.join(get_dst_table_dir(input_path), get_dst_table_name(input_path, output_delim));

    if (rbql_query.startsWith(test_marker)) {
        if (rbql_query.indexOf('nopython') != -1) {
            cmd = 'nopython';
        }
        let args = [absolute_path_map['rbql mock/rbql_mock.py'], rbql_query];
        run_command(cmd, args, close_and_error_guard, function(error_code, stdout, stderr) { handle_command_result(input_path, output_path, output_delim, output_policy, error_code, stdout, stderr, webview_report_handler); });
        return;
    }
    if (backend_language == 'js') {
        let warnings = [];
        let result_doc = null;
        let target_language_id = map_dialect_to_language_id(output_delim, output_policy);
        try {
            if (is_web_ext) {
                let result_lines = await ll_rainbow_utils().rbql_query_web(rbql_query, rbql_context.input_document, input_delim, input_policy, output_delim, output_policy, warnings, with_headers, comment_prefix);
                let output_doc_cfg = {content: result_lines.join('\n'), language: target_language_id};
                if (target_language_id == DYNAMIC_CSV) {
                    extension_context.dynamic_dialect_for_next_request = [output_delim, output_policy];
                }
                extension_context.autodetection_temporarily_disabled_for_rbql = true;
                result_doc = await vscode.workspace.openTextDocument(output_doc_cfg);
                extension_context.dynamic_dialect_for_next_request = null;
                extension_context.autodetection_temporarily_disabled_for_rbql = false;
                webview_report_handler(null, null);
                await handle_rbql_result_file_web(result_doc, warnings);
            } else {
                let csv_options = {'bulk_read': true};
                await ll_rainbow_utils().rbql_query_node(global_state, rbql_query, input_path, input_delim, input_policy, output_path, output_delim, output_policy, csv_encoding, warnings, with_headers, comment_prefix, /*user_init_code=*/'', csv_options);
                result_set_parent_map.set(safe_lower(output_path), input_path);
                extension_context.autodetection_temporarily_disabled_for_rbql = true;
                result_doc = await vscode.workspace.openTextDocument(output_path);
                extension_context.autodetection_temporarily_disabled_for_rbql = false;
                webview_report_handler(null, null);
                if (target_language_id == DYNAMIC_CSV) {
                    // TODO it would be better to set this before openTextDocument and adjust the logic so this would affect autodetection.
                    extension_context.dynamic_dialect_for_next_request = [output_delim, output_policy];
                }
                await handle_rbql_result_file_node(result_doc, output_delim, output_policy, warnings);
                extension_context.dynamic_dialect_for_next_request = null;
            }
        } catch (e) {
            let [error_type, error_msg] = ll_rbql_csv().exception_to_error_info(e);
            webview_report_handler(error_type, error_msg);
            return;
        }
    } else {
        if (is_web_ext) {
            webview_report_handler('Input error', 'Python backend for RBQL is not supported in web version, please use JavaScript backend.');
            return;
        }
        let cmd_safe_query = Buffer.from(rbql_query, "utf-8").toString("base64");
        if (!comment_prefix) {
            comment_prefix = '';
        }
        let args = [absolute_path_map['rbql_core/vscode_rbql.py'], cmd_safe_query, input_path, input_delim, input_policy, output_path, output_delim, output_policy, comment_prefix, csv_encoding];
        if (with_headers)
            args.push('--with_headers');
        run_command(cmd, args, close_and_error_guard, function(error_code, stdout, stderr) { handle_command_result(input_path, output_path, output_delim, output_policy, error_code, stdout, stderr, webview_report_handler); });
    }
}


async function set_header_line() {
    let active_editor = get_active_editor();
    if (!active_editor)
        return;
    var active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;

    let [delim, policy, _comment_prefix] = get_dialect(active_doc);
    if (policy === null) {
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


function preserve_original_language_id_if_needed(file_path, original_language_id, original_language_ids) {
    if (original_language_id == DYNAMIC_CSV) {
        // This is to prevent invalid noop "dynamic csv" -> "dynamic csv" switch without carying dialect info.
        return;
    }
    if (original_language_ids.has(file_path)) {
        // Rainbow Off should act more like an actuall off i.e. return to the first filetype in the chain instead of the previous one.
        return;
    }
    original_language_ids.set(file_path, original_language_id);
}


async function manually_set_rainbow_separator(policy=null) {
    // The effect of manually setting the separator will disapear in the preview mode when the file is toggled in preview tab: see https://code.visualstudio.com/docs/getstarted/userinterface#_preview-mode
    let active_editor = get_active_editor();
    if (!active_editor)
        return;
    var active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    let selection = active_editor.selection;
    if (!selection) {
        show_single_line_error("Selection is empty");
        return;
    }
    if (selection.start.line != selection.end.line) {
        show_single_line_error("Rainbow separator must not span multiple lines");
        return;
    }
    let separator = active_doc.lineAt(selection.start.line).text.substring(selection.start.character, selection.end.character);
    if (!separator) {
        show_single_line_error("Make nonempty separator selection with the cursor");
        return;
    }
    if (policy == QUOTED_RFC_POLICY && separator != ',' && separator != ';') {
        show_single_line_error("Only comma and semicolon separators are currently supported to use with multiline fields.");
        return;
    }
    if (policy === null) {
        policy = get_default_policy(separator);
    }
    let language_id = map_dialect_to_language_id(separator, policy);
    // Adding to stoplist just in case: this is the manual op, so the user now fully controls the filetype.
    extension_context.autodetection_stoplist.add(active_doc.fileName);
    if (language_id == DYNAMIC_CSV) {
        extension_context.dynamic_document_dialects.set(active_doc.fileName, {delim: separator, policy: policy});
    }
    let original_language_id = active_doc.languageId;
    if (original_language_id == DYNAMIC_CSV && language_id == DYNAMIC_CSV) {
        // We need to somehow explicitly re-tokenize file, because otherwise setTextDocumentLanguage would be a NO-OP, so we do this workaround with temporarily switching to plaintext and back.
        extension_context.autodetection_stoplist.add(active_doc.fileName); // This is to avoid potential autodetection in plaintext.
        extension_context.autodetection_temporarily_disabled_for_rbql = true;
        active_doc = await vscode.languages.setTextDocumentLanguage(active_doc, 'plaintext');
        extension_context.autodetection_temporarily_disabled_for_rbql = false;
    }
    let doc = await vscode.languages.setTextDocumentLanguage(active_doc, language_id);
    preserve_original_language_id_if_needed(doc.fileName, original_language_id, extension_context.original_language_ids);
}


async function set_comment_prefix() {
    let active_editor = get_active_editor();
    if (!active_editor)
        return;
    var active_doc = get_active_doc(active_editor);
    if (!active_doc)
        return;
    let selection = active_editor.selection;
    if (!selection) {
        show_single_line_error("Selection is empty");
        return;
    }
    let comment_prefix = active_doc.lineAt(selection.start.line).text.substring(selection.start.character, selection.end.character);
    extension_context.custom_comment_prefixes.set(active_doc.fileName, comment_prefix);
    if (!comment_prefix) {
        manual_comment_prefix_stoplist.add(active_doc.fileName);
    } else {
        manual_comment_prefix_stoplist.delete(active_doc.fileName);
    }
    if (comment_prefix) {
        vscode.languages.setLanguageConfiguration(active_doc.languageId, { comments: { lineComment: comment_prefix } });
    }
    if (active_doc.languageId == DYNAMIC_CSV) {
        // Re-enable tokenization to explicitly trigger the highligthing. Sometimes this doesn't happen automatically.
        enable_dynamic_semantic_tokenization();
    } else {
        // Re-enable comment tokenization to explicitly adjust the comment highligthing (sometimes to disable it if comment prefix is set to an empty string).
        register_comment_tokenization_handler();
    }
}


async function restore_original_language() {
    var active_doc = get_active_doc();
    if (!active_doc)
        return;
    let file_path = active_doc.fileName;
    extension_context.autodetection_stoplist.add(file_path);
    let original_language_id = 'plaintext';
    if (extension_context.original_language_ids.has(file_path)) {
        original_language_id = extension_context.original_language_ids.get(file_path);
    }
    if (!original_language_id || original_language_id == active_doc.languageId) {
        show_single_line_error("Unable to restore original language");
        return;
    }

    let doc = await vscode.languages.setTextDocumentLanguage(active_doc, original_language_id);
    extension_context.original_language_ids.delete(file_path);
    disable_rainbow_features_if_non_csv(doc);
    // If the previous language is restored via native VSCode filetype selection the custom dialect info will be kept and in case of future manual Dynamic CSV selection the highlighting will be automatically activated without separator entry dialog.
    extension_context.dynamic_document_dialects.delete(file_path);
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
    await save_to_global_state(ll_rainbow_utils().make_table_name_key(table_name), file_path);
}


async function set_virtual_header() {
    var active_doc = get_active_doc();
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (policy === null) {
        show_single_line_error('Unable to set virtual header: no separator specified');
        return;
    }
    var file_path = active_doc.fileName;
    if (!file_path) {
        show_single_line_error('Unable to edit column names for non-file documents');
        return;
    }
    var old_header = get_header(active_doc, delim, policy, comment_prefix);
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
    if (!active_editor)
        return;
    let active_doc = active_editor.document;
    if (!active_doc)
        return;
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (policy === null) {
        return;
    }
    let position = ll_rainbow_utils().get_cursor_position_if_unambiguous(active_editor);
    if (!position) {
        show_single_line_error('Unable to enter column edit mode: make sure that no text is selected and only one cursor is active');
        return;
    }
    if (active_doc.lineCount >= 10000) {
        show_single_line_error('Multicursor column edit works only for files smaller than 10000 lines.');
        return;
    }
    let col_num = (ll_rainbow_utils().get_cursor_position_info(vscode, active_doc, delim, policy, comment_prefix, position)).column_number;
    let [selections, error_msg, warning_msg] = ll_rainbow_utils().generate_column_edit_selections(vscode, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    if (error_msg !== null) {
        show_single_line_error(error_msg);
        return;
    }
    if (warning_msg) {
        vscode.window.showWarningMessage(warning_msg);
    }
    active_editor.selections = selections;
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
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (policy === null) {
        return;
    }
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
        show_align_shrink_button(active_doc.fileName);
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
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (policy === null) {
        return;
    }
    let progress_options = {location: vscode.ProgressLocation.Window, title: 'Rainbow CSV'};
    await vscode.window.withProgress(progress_options, async (progress) => {
        progress.report({message: 'Calculating column statistics'});
        await push_current_stack_to_js_callback_queue_to_allow_ui_update();
        let [column_stats, first_failed_line, records, comments] = ll_rainbow_utils().calc_column_stats(active_doc, delim, policy, comment_prefix);
        if (first_failed_line) {
            show_single_line_error(`Unable to align: Inconsistent double quotes at line ${first_failed_line}`);
            return;
        }
        column_stats = ll_rainbow_utils().adjust_column_stats(column_stats, delim.length);
        if (column_stats === null) {
            show_single_line_error('Unable to allign: Internal Rainbow CSV Error');
            return;
        }
        progress.report({message: 'Preparing final alignment'});
        await push_current_stack_to_js_callback_queue_to_allow_ui_update();
        let aligned_doc_text = ll_rainbow_utils().align_columns(records, comments, column_stats, delim);
        aligned_files.add(active_doc.fileName);
        show_align_shrink_button(active_doc.fileName);
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
    let parent_table_path = result_set_parent_map.get(safe_lower(file_path));
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
        ll_rainbow_utils().sample_preview_records_from_context(rbql_context, init_msg, preview_window_size, cached_table_parse_result);
        let path_key = file_path_to_query_key(rbql_context.input_document_path);
        if (last_rbql_queries.has(path_key))
            init_msg['last_query'] = last_rbql_queries.get(path_key);
        let history_list = get_from_global_state('rbql_query_history', []);
        init_msg['query_history'] = history_list;
        init_msg['policy'] = rbql_context.policy;
        init_msg['with_headers'] = rbql_context.with_headers;
        init_msg['header'] = rbql_context.header;
        init_msg['is_web_ext'] = is_web_ext;
        if (integration_test_options) {
            init_msg['integration_test_language'] = integration_test_options.rbql_backend;
            init_msg['integration_test_query'] = integration_test_options.rbql_query;
            init_msg['integration_test_with_headers'] = integration_test_options.with_headers || false;
            init_msg['integration_test_delay'] = integration_test_options.integration_test_delay || 2000;
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
        ll_rainbow_utils().sample_preview_records_from_context(rbql_context, protocol_message, preview_window_size, cached_table_parse_result);
        await webview.postMessage(protocol_message);
    }

    if (message_type == 'run') {
        let rbql_query = message['query'];
        let backend_language = message['backend_language'];
        let encoding = message['encoding'];
        let output_dialect = message['output_dialect'];
        let with_headers = message['with_headers'];
        await update_query_history(rbql_query);
        await run_rbql_query(rbql_context.input_document_path, encoding, backend_language, rbql_query, output_dialect, with_headers, webview_report_handler);
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

    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (policy === null) {
        policy = 'monocolumn';
        delim = 'monocolumn';
    }
    let with_headers_by_default = get_from_config('rbql_with_headers_by_default', false);
    let with_headers = get_from_global_state(make_with_headers_key(input_path), with_headers_by_default);
    let header = get_header_from_document(active_doc, delim, policy, comment_prefix);
    rbql_context = {
        "input_document": active_doc,
        "input_document_path": input_path,
        "requested_start_record": 0,
        "delim": delim,
        "policy": policy,
        "comment_prefix": comment_prefix,
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


function autodetect_dialect(config, active_doc, candidate_separators, comment_prefix) {
    let candidate_dialects = [];
    for (let separator of candidate_separators) {
        let policy = get_default_policy(separator);
        let dialect_id = map_dialect_to_language_id(separator, policy);
        if (!dialect_id || !policy)
            continue;
        candidate_dialects.push([dialect_id, separator, policy]);
        if (separator == ',' || separator == ';') {
            candidate_dialects.push([DYNAMIC_CSV, separator, QUOTED_RFC_POLICY]);
        }
    }
    let detect_trailing_spaces = get_from_config('csv_lint_detect_trailing_spaces', false, config);
    let min_num_lines = get_from_config('autodetection_min_line_count', 10, config);
    if (active_doc.lineCount < min_num_lines)
        return [null, null, null];
    let [best_dialect, best_separator, best_policy, best_dialect_first_trailing_space_line] = [null, null, null, null];
    let best_dialect_num_columns = 1;
    for (let candidate_dialect of candidate_dialects) {
        let [dialect_id, separator, policy] = candidate_dialect;
        let [_records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, _comments] = fast_load_utils.parse_document_records(active_doc, separator, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/false, /*preserve_quotes_and_whitespaces=*/true, detect_trailing_spaces, /*min_num_fields_for_autodetection=*/best_dialect_num_columns + 1);
        if (first_defective_line !== null || fields_info.size != 1)
            continue;
        if (num_records_parsed < min_num_lines) {
            // Ensure that min_num_lines also applies to number of parsed records. There could be a discrepancy between number of lines and records due to comment lines and/or multiline rfc records.
            continue;
        }
        let num_columns = Array.from(fields_info.keys())[0];
        if (num_columns >= best_dialect_num_columns + 1) {
            best_dialect_num_columns = num_columns;
            [best_dialect, best_separator, best_policy] = [dialect_id, separator, policy];
            best_dialect_first_trailing_space_line = first_trailing_space_line;
        }
    }
    return [best_dialect, best_separator, best_policy, best_dialect_first_trailing_space_line];
}


function autodetect_dialect_frequency_based(active_doc, candidate_separators, max_num_chars_to_test) {
    let [best_dialect, best_separator, best_policy] = ['csv', ',', QUOTED_POLICY];
    let best_dialect_frequency = 0;
    let data = active_doc.getText();
    if (!data)
        return [best_dialect, best_separator, best_policy];
    for (let separator of candidate_separators) {
        if (separator == ' ' || separator == '.')
            continue; // Whitespace and dot have advantage over other separators in this algorithm, so we just skip them.
        let frequency = 0;
        for (let j = 0; j < max_num_chars_to_test && j < data.length; j++) {
            if (data[j] == separator)
                frequency += 1;
        }
        if (frequency > best_dialect_frequency) {
            let policy = get_default_policy(separator);
            let dialect_id = map_dialect_to_language_id(separator, policy);
            [best_dialect, best_separator, best_policy] = [dialect_id, separator, policy];
            best_dialect_frequency = frequency;
        }
    }
    return [best_dialect, best_separator, best_policy];
}


async function try_autoenable_rainbow_csv(vscode, config, extension_context, active_doc) {
    // VSCode to some extent is capable of "remembering" doc id in the previous invocation, at least when used in debug mode.

    // VSCode may (and will?) forget documentId of a document "A" if document "B" is opened in the tab where "A" was (double VS single click in file browser panel).
    // see https://code.visualstudio.com/docs/getstarted/userinterface#_preview-mode
    if (extension_context.autodetection_temporarily_disabled_for_rbql)
        return active_doc;
    if (!active_doc)
        return active_doc;
    if (!get_from_config('enable_separator_autodetection', false, config))
        return active_doc;
    let candidate_separators = get_from_config('autodetect_separators', [], config).map((s) => s === 'TAB' ? '\t' : s);
    var original_language_id = active_doc.languageId;
    var file_path = active_doc.fileName;
    if (!file_path || extension_context.autodetection_stoplist.has(file_path) || file_path.endsWith('.git')) { // For some reason there are some ghost '.git' files. TODO figure this out!
        return active_doc;
    }
    let is_default_csv = file_path.endsWith('.csv') && original_language_id == 'csv';
    if (original_language_id != 'plaintext' && !is_default_csv)
        return active_doc;
    let comment_prefix_for_autodetection = get_from_config('comment_prefix', '', config) || '#'; // Assume '#' as a comment prefix for autodetection purposes only.
    let [rainbow_csv_language_id, delim, policy, first_trailing_space_line] = autodetect_dialect(config, active_doc, candidate_separators, comment_prefix_for_autodetection);
    if (rainbow_csv_language_id) {
        // Add the file to lint results to avoid re-parsing it with CSV Lint later.
        extension_context.lint_results.set(`${active_doc.fileName}.${rainbow_csv_language_id}`, {'is_ok': true, 'first_trailing_space_line': first_trailing_space_line});
    } else if (!rainbow_csv_language_id && is_default_csv) {
        // Smart autodetection method has failed, but we need to choose a separator because this is a csv file. Let's just find the most popular one within the first N characters.
        [rainbow_csv_language_id, delim, policy] = autodetect_dialect_frequency_based(active_doc, candidate_separators, /*max_num_chars_to_test=*/10000);
    }
    if (!rainbow_csv_language_id)
        return active_doc;
    // Intentionally do not store comment prefix used for autodetection in the dialect info since it is not file-specific anyway and is stored in the settings.
    // And in case if user changes it in the settings it would immediately affect the autodetected files.
    if (rainbow_csv_language_id == DYNAMIC_CSV)  {
        extension_context.dynamic_document_dialects.set(active_doc.fileName, {delim: delim, policy: policy});
    }
    if (rainbow_csv_language_id == original_language_id)
        return active_doc;
    let doc = await vscode.languages.setTextDocumentLanguage(active_doc, rainbow_csv_language_id);
    preserve_original_language_id_if_needed(file_path, original_language_id, extension_context.original_language_ids);
    return doc;
}


async function handle_first_edit_for_an_empty_doc(change_event) {
    if (!change_event)
        return;
    if (doc_first_edit_subscription) {
        doc_first_edit_subscription.dispose();
        doc_first_edit_subscription = null;
    }
    await try_autoenable_rainbow_csv(vscode, vscode.workspace.getConfiguration('rainbow_csv'), extension_context, change_event.document);
}


function register_csv_copy_paste_for_empty_doc(active_doc) {
    if (!get_from_config('enable_separator_autodetection', false))
        return;
    if (!active_doc || doc_first_edit_subscription)
        return;
    if (!active_doc.isUntitled && active_doc.lineCount != 0)
        return;
    doc_first_edit_subscription = vscode.workspace.onDidChangeTextDocument(handle_first_edit_for_an_empty_doc);
}


async function handle_editor_switch(editor) {
    let active_doc = get_active_doc(editor);
    disable_rainbow_features_if_non_csv(active_doc);
    await enable_rainbow_features_if_csv(active_doc); // No-op if non-csv.
}


function do_handle_cursor_movement() {
    if (!show_column_info_button() && column_info_button) {
        column_info_button.hide();
    }
}


function handle_cursor_movement(_unused_cursor_event) {
    if (cursor_timeout_handle !== null) {
        clearTimeout(cursor_timeout_handle);
    }
    // We need timeout delay here to deduplicate/debounce events from multiple consecutive movements, see https://stackoverflow.com/a/49050990/2898283.
    cursor_timeout_handle = setTimeout(() => do_handle_cursor_movement(), 10);
}


async function handle_doc_open(active_doc) {
    // The onDidOpenTextDocument handler will trigger for already "opened" docs too if they are re-opened in the same tab. Example
    // Document "A" opens in tab1 -> triggers onDidOpenTextDocument
    // Document "B" opens in tab1 -> triggers onDidOpenTextDocument  (this could happen if user clicks on document "B" in the left file browser panel)
    // Document "A" opens in tab1 -> triggers onDidOpenTextDocument again! The previous languageId is reset.
    // In other words if user opens a different document in the same tab (single click VS double click in the file browser panel) it may trigger the curent document closing and opening of a new doc.
    // This behavior is called Preview Mode, see https://vscode.one/new-tab-vscode/ and https://code.visualstudio.com/docs/getstarted/userinterface#_preview-mode
    
    if (active_doc.uri.scheme != 'file' && active_doc.uri.scheme != 'untitled' && active_doc.uri.scheme != 'vscode-test-web') {
        // Current document has unknown file scheme. One reason for this could be that it was created by another extension, see https://code.visualstudio.com/api/extension-guides/virtual-documents#events-and-visibility and https://github.com/mechatroner/vscode_rainbow_csv/issues/123 
        // "vscode-test-web" scheme is used for browser unit tests.
        return;
    }
    register_csv_copy_paste_for_empty_doc(active_doc);
    active_doc = await try_autoenable_rainbow_csv(vscode, vscode.workspace.getConfiguration('rainbow_csv'), extension_context, active_doc);
    disable_rainbow_features_if_non_csv(active_doc);
    await enable_rainbow_features_if_csv(active_doc); // No-op if non-csv.
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
            return make_hover(document, language_id, position, token);
        }
    });
    context.subscriptions.push(hover_provider);
}


class RainbowTokenProvider {
    // We don't utilize typescript `implement` interface keyword, because TS doesn't seem to be exporting interfaces to JS (unlike classes).
    constructor() {
    }
    async provideDocumentRangeSemanticTokens(document, range, _token) {
        let [delim, policy, comment_prefix] = get_dialect(document);
        if (!policy || document.languageId != DYNAMIC_CSV) {
            return null;
        }
        let table_ranges = ll_rainbow_utils().parse_document_range(vscode, document, delim, policy, comment_prefix, range);
        // Create a new builder to clear the previous tokens.
        const builder = new vscode.SemanticTokensBuilder(tokens_legend);
        for (let row_info of table_ranges) {
            if (row_info.hasOwnProperty('comment_range')) {
                builder.push(row_info.comment_range, 'comment');
            } else {
                for (let col_num = 0; col_num < row_info.record_ranges.length; col_num++) {
                    for (let record_range of row_info.record_ranges[col_num]) {
                        // One logical field can map to multiple tokens if it spans multiple lines because VSCode doesn't support multiline tokens.
                        builder.push(record_range, tokenTypes[col_num % tokenTypes.length]);
                    }
                }
            }
        }
        return builder.build();
    }
}


class CommentTokenProvider {
    constructor() {
    }
    async provideDocumentRangeSemanticTokens(doc, range, _token) {
        let [_delim, policy, comment_prefix] = get_dialect(doc);
        if (manual_comment_prefix_stoplist.has(doc.fileName) && !comment_prefix) {
            // We can't use empty comment prefix (and early return) - in that case the previous highlighting would not go away due to a VSCode quirk, need to make an empty build instead to make sure that all previously highlighted lines were cleared.
            comment_prefix = '#####COMMENT_PREFIX_THAT_CAN_NOT_OCCURE_IN_A_NORMAL_FILE_AND_EVEN_IF_IT_OCCURES_NOT_A_BIG_DEAL####';
        }
        if (!comment_prefix || policy === null || policy == QUOTED_RFC_POLICY) {
            return null; // Sanity check: with QUOTED_RFC_POLICY we should be using a different tokenizer which also handles comments.
        }
        // Create a new builder to clear the previous tokens.
        const builder = new vscode.SemanticTokensBuilder(tokens_legend);
        let begin_line = Math.max(0, range.start.line - dynamic_csv_highlight_margin);
        let end_line = Math.min(doc.lineCount, range.end.line + dynamic_csv_highlight_margin);
        for (let lnum = begin_line; lnum < end_line; lnum++) {
            let line_text = doc.lineAt(lnum).text;
            if (line_text.startsWith(comment_prefix)) {
                builder.push(new vscode.Range(lnum, 0, lnum, line_text.length), 'comment');
            }
        }
        return builder.build();
    }
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
    var set_comment_prefix_cmd = vscode.commands.registerCommand('rainbow-csv.SetCommentPrefix', set_comment_prefix);
    var edit_column_names_cmd = vscode.commands.registerCommand('rainbow-csv.SetVirtualHeader', set_virtual_header);
    var set_join_table_name_cmd = vscode.commands.registerCommand('rainbow-csv.SetJoinTableName', set_join_table_name); // WEB_DISABLED
    var column_edit_before_cmd = vscode.commands.registerCommand('rainbow-csv.ColumnEditBefore', async function() { await column_edit('ce_before'); });
    var choose_dynamic_separator_cmd = vscode.commands.registerCommand('rainbow-csv.ChooseDynamicSeparator', async function() { await choose_dynamic_separator(); });
    var column_edit_after_cmd = vscode.commands.registerCommand('rainbow-csv.ColumnEditAfter', async function() { await column_edit('ce_after'); });
    var column_edit_select_cmd = vscode.commands.registerCommand('rainbow-csv.ColumnEditSelect', async function() { await column_edit('ce_select'); });
    var set_separator_cmd = vscode.commands.registerCommand('rainbow-csv.RainbowSeparator', () => { manually_set_rainbow_separator(/*policy=*/null); });
    var set_separator_multiline_cmd = vscode.commands.registerCommand('rainbow-csv.RainbowSeparatorMultiline', () => { manually_set_rainbow_separator(QUOTED_RFC_POLICY); });
    var rainbow_off_cmd = vscode.commands.registerCommand('rainbow-csv.RainbowSeparatorOff', restore_original_language);
    var sample_head_cmd = vscode.commands.registerCommand('rainbow-csv.SampleHead', async function(uri) { await make_preview(uri, 'head'); }); // WEB_DISABLED
    var sample_tail_cmd = vscode.commands.registerCommand('rainbow-csv.SampleTail', async function(uri) { await make_preview(uri, 'tail'); }); // WEB_DISABLED
    var align_cmd = vscode.commands.registerCommand('rainbow-csv.Align', align_table);
    var shrink_cmd = vscode.commands.registerCommand('rainbow-csv.Shrink', shrink_table);
    var copy_back_cmd = vscode.commands.registerCommand('rainbow-csv.CopyBack', copy_back); // WEB_DISABLED
    var internal_test_cmd = vscode.commands.registerCommand('rainbow-csv.InternalTest', run_internal_test_cmd);

    var doc_open_event = vscode.workspace.onDidOpenTextDocument(handle_doc_open);
    var switch_event = vscode.window.onDidChangeActiveTextEditor(handle_editor_switch);

    enable_dynamic_semantic_tokenization();

    if (get_from_config('comment_prefix', null)) {
        register_comment_tokenization_handler();
    }

    // The only purpose to add the entries to context.subscriptions is to guarantee their disposal during extension deactivation
    context.subscriptions.push(lint_cmd);
    context.subscriptions.push(rbql_cmd);
    context.subscriptions.push(edit_column_names_cmd);
    context.subscriptions.push(column_edit_before_cmd);
    context.subscriptions.push(column_edit_after_cmd);
    context.subscriptions.push(column_edit_select_cmd);
    context.subscriptions.push(set_separator_cmd);
    context.subscriptions.push(set_separator_multiline_cmd);
    context.subscriptions.push(rainbow_off_cmd);
    context.subscriptions.push(sample_head_cmd);
    context.subscriptions.push(sample_tail_cmd);
    context.subscriptions.push(set_join_table_name_cmd);
    context.subscriptions.push(align_cmd);
    context.subscriptions.push(shrink_cmd);
    context.subscriptions.push(copy_back_cmd);
    context.subscriptions.push(set_header_line_cmd);
    context.subscriptions.push(set_comment_prefix_cmd);
    context.subscriptions.push(internal_test_cmd);
    context.subscriptions.push(choose_dynamic_separator_cmd);

    context.subscriptions.push(doc_open_event);
    context.subscriptions.push(switch_event);


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

// Exports just for unit tests:
exports.autodetect_dialect_frequency_based = autodetect_dialect_frequency_based;
exports.try_autoenable_rainbow_csv = try_autoenable_rainbow_csv;
