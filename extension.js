const vscode = require('vscode');

const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');

const fast_load_utils = require('./fast_load_utils.js');

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
var rainbow_on_status_bar_button = null;
var copy_back_button = null;
var column_info_button = null;
var dynamic_dialect_select_button = null;

var rbql_context = null;

var debug_log_output_channel = null;

var last_rbql_queries = new Map(); // Query history does not replace this structure, it is also used to store partially entered queries for preview window switch.

var client_html_template = null;

// This `global_state` is persistent across VSCode restarts.
var global_state = null;

var preview_panel = null;

var doc_first_edit_subscription = null;
var keyboard_cursor_subscription = null;

var last_closed_rainbow_doc_info = null;

var _unit_test_last_rbql_report = null; // For unit tests only.
var _unit_test_last_warnings = null; // For unit tests only.

let cursor_timeout_handle = null;

let rainbow_token_event = null;
let comment_token_event = null;
let sticky_header_disposable = null;

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
    reenable_rainbow_language_infos: new Map(), // This only needed for "Rainbow On" functionality that reverts "Rainbow Off" effect.
    autodetection_stoplist: new Set(),
    autodetection_temporarily_disabled_for_rbql: false,
    dynamic_dialect_for_next_request: null,
    logging_enabled: false,
    logging_next_context_id: 1,
};

const dialect_map = {
    'csv': [',', QUOTED_POLICY],
    'tsv': ['\t', SIMPLE_POLICY],
    'csv (semicolon)': [';', QUOTED_POLICY],
    'csv (pipe)': ['|', SIMPLE_POLICY],
    'csv (whitespace)': [' ', WHITESPACE_POLICY],
    [DYNAMIC_CSV]: [null, null]
};


const COMMENT_TOKEN = 'comment';
const rainbow_token_types = ['rainbow1', 'rainbow2', 'rainbow3', 'rainbow4', 'rainbow5', 'rainbow6', 'rainbow7', 'rainbow8', 'rainbow9', 'rainbow10'];
const all_token_types = rainbow_token_types.concat([COMMENT_TOKEN]);
const tokens_legend = new vscode.SemanticTokensLegend(all_token_types);


function is_eligible_scheme(vscode_doc)  {
    // Make sure that the the doc has a valid scheme.
    // We don't want to handle virtual docs and docs created by other extensions, see https://code.visualstudio.com/api/extension-guides/virtual-documents#events-and-visibility and https://github.com/mechatroner/vscode_rainbow_csv/issues/123
    // VScode also opens pairing virtual `.git` documents for git-controlled files that we also want to skip, see https://github.com/microsoft/vscode/issues/22561.
    // "vscode-test-web" scheme is used for browser unit tests.
    return vscode_doc && vscode_doc.uri && ['file', 'untitled', 'vscode-test-web'].indexOf(vscode_doc.uri.scheme) != -1;
}


function is_eligible_doc(vscode_doc) {
    // For new untitled scratch documents `fileName` would be "Untitled-1", "Untitled-2", etc, so we won't enter this branch.
    return vscode_doc && vscode_doc.uri && vscode_doc.fileName && is_eligible_scheme(vscode_doc);
}


function is_rainbow_dialect_doc(vscode_doc) {
    return is_eligible_doc(vscode_doc) && dialect_map.hasOwnProperty(vscode_doc.languageId);
}


function make_dialect_info(delim, policy) {
    return {'delim': delim, 'policy': policy};
}


function make_dynamic_dialect_key(file_path) {
    return 'dynamic_dialect:' + file_path;
}


async function save_dynamic_info(extension_context, file_path, dialect_info) {
    await save_to_global_state(make_dynamic_dialect_key(file_path), dialect_info);
    extension_context.dynamic_document_dialects.set(file_path, dialect_info);
}


async function remove_dynamic_info(file_path) {
    await save_to_global_state(make_dynamic_dialect_key(file_path), undefined);
    extension_context.dynamic_document_dialects.delete(file_path);
}


function get_dynamic_info(file_path) {
    // Filetypes (lang modes) are not preserved across doc reopen but surprisingly preserved across VSCode restarts so we are also storing them in persistent global state.
    // Persistent dialect info has some minor drawbacks (e.g. performance also restart not completely resetting the state is an issue by itself in some scenarios) and could be reconsidered if more serious issues are found.
    if (extension_context.dynamic_document_dialects.has(file_path)) {
        return extension_context.dynamic_document_dialects.get(file_path);
    }
    // Failed to get from the session-local dynamic_document_dialects - check if we have it persistently stored from a previous session.
    let dialect_info = get_from_global_state(make_dynamic_dialect_key(file_path), null);
    if (dialect_info && dialect_info.hasOwnProperty('delim') && dialect_info.hasOwnProperty('policy')) {
        extension_context.dynamic_document_dialects.set(file_path, dialect_info);
        return dialect_info;
    }
    return null;
}


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


async function report_progress(progress, status_message) {
    progress.report({message: status_message});
    // Push the current stack to the JS callback queue to allow UI update.
    await sleep(0);
}


function get_from_global_state(key, default_value) {
    // Load KV pair from the "global state" which is persistent across VSCode restarts.
    if (global_state) {
        var value = global_state.get(key);
        if (value !== null && value !== undefined)
            return value;
    }
    return default_value;
}


async function save_to_global_state(key, value) {
    // Save KV pair to the "global state" which is persistent across VSCode restarts.
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
    return 'rbql_header_info:' + file_path;
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


class StackContextLogWrapper {
    // Use class instead of pure function to avoid passing context name and checking if logging is enabled in the config in each call.
    constructor(context_name, caller_context_id=null) {
        this.context_name = context_name;
        this.logging_enabled = extension_context.logging_enabled;
        this.context_id = caller_context_id === null ? extension_context.logging_next_context_id : caller_context_id;
        extension_context.logging_next_context_id += 1;
    }

    log_doc_event(event_name, vscode_doc=null) {
        if (!this.logging_enabled)
            return;
        try {
            let full_event = `CID:${this.context_id}, ${this.context_name}:${event_name}`;
            if (vscode_doc) {
                full_event = `${full_event}, doc_lang:${vscode_doc.languageId}`;
                if (vscode_doc.uri) {
                    let str_uri = vscode_doc.uri.toString(/*skipEncoding=*/true);
                    full_event = `${full_event}, doc_uri:${str_uri}`;
                }
            } else {
                full_event = `${full_event}, no_doc:1`;
            }
            // Use "info" level because logging is flag-guarded by the extension-level setting.
            debug_log_output_channel.info(full_event);
        } catch (error) {
            console.error(`Rainbow CSV: Unexpected log failure. ${this.context_name}:${this.event_name}`);
            return;
        }
    }

    log_simple_event(event_name) {
        if (!this.logging_enabled)
            return;
        try {
            let full_event = `CID:${this.context_id}, ${this.context_name}:${event_name}`;
            debug_log_output_channel.info(full_event);
        } catch (error) {
            console.error(`Rainbow CSV: Unexpected log failure. ${this.context_name}:${this.event_name}`);
            return;
        }
    }
}


function get_header_from_document(document, delim, policy, comment_prefix) {
    let [_header_lnum, header_line] = ll_rainbow_utils().get_header_line(document, comment_prefix);
    if (!header_line) {
        return null;
    }
    return csv_utils.smart_split(header_line, delim, policy, /*preserve_quotes_and_whitespaces=*/false)[0];
}


function get_header(document, delim, policy, comment_prefix) {
    var file_path = document.fileName;
    if (file_path) {
        let header_info = get_from_global_state(make_header_key(file_path), null);
        if (header_info !== null && header_info.header !== null) {
            return header_info.header;
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
    let dialect_info = null;
    if (language_id == DYNAMIC_CSV) {
        dialect_info = get_dynamic_info(document.fileName);
    }
    if (dialect_info) {
        return [dialect_info.delim, dialect_info.policy, comment_prefix];
    }
    // The language id can be `dynamic csv` here e.g. if user just now manually selected the "Dynamic CSV" filetype.
    return [null, null, null];
}


function enable_rainbow_ui(active_doc) {
    if (dynamic_dialect_select_button) {
        dynamic_dialect_select_button.hide();
    }
    ll_rainbow_utils().show_lint_status_bar_button(vscode, extension_context, active_doc.fileName, active_doc.languageId);
    show_rbql_status_bar_button();
    show_align_shrink_button(active_doc.fileName);
    show_rainbow_off_status_bar_button();
    show_rbql_copy_to_source_button(active_doc.fileName);
    show_column_info_button(); // This function finds active_doc internally, but the possible inconsistency is harmless.

    if (get_from_config('enable_cursor_position_info', false)) {
        keyboard_cursor_subscription = vscode.window.onDidChangeTextEditorSelection(handle_cursor_movement);
    }
}


class StickyHeaderProvider {
    // We don't utilize typescript `implement` interface keyword, because TS doesn't seem to be exporting interfaces to JS (unlike classes).
    constructor() {
    }
    async provideDocumentSymbols(document) {
        // This can trigger multiple times for the same doc because otherwise this won't work in case of e.g. header edit.
        let [_delim, policy, comment_prefix] = get_dialect(document);
        if (!policy) {
            return null;
        }
        let header_lnum = null;
        var file_path = document.fileName;
        if (file_path) {
            let header_info = get_from_global_state(make_header_key(file_path), null);
            if (header_info !== null && header_info.header_line_num !== null) {
                header_lnum = header_info.header_line_num;
            }
        }

        if (header_lnum === null) {
            header_lnum = ll_rainbow_utils().get_header_line(document, comment_prefix)[0];
        }
        if (header_lnum === null || header_lnum >= document.lineCount - 1) {
            return null;
        }
        let full_range = new vscode.Range(header_lnum, 0, document.lineCount - 1, 65535);
        full_range = document.validateRange(full_range); // Just in case, should be always NOOP.
        let header_range = new vscode.Range(header_lnum, 0, header_lnum, 65535);
        if (!full_range.contains(header_range)) {
            return; // Should never happen.
        }
        let symbol_kind = vscode.SymbolKind.File; // It is vscode.SymbolKind.File because it shows a nice "File" icon in the upper navigational panel. Another nice option is "Class".
        let header_symbol = new vscode.DocumentSymbol('data', '', symbol_kind, full_range, header_range);
        return [header_symbol];
    }
}


function reconfigure_sticky_header_provider(force=false) {
    let enable_sticky_header = get_from_config('enable_sticky_header', false);
    if (!enable_sticky_header) {
        if (sticky_header_disposable !== null) {
            sticky_header_disposable.dispose();
            sticky_header_disposable = null;
        }
        return;
    }
    if (sticky_header_disposable !== null && force) {
        sticky_header_disposable.dispose();
        sticky_header_disposable = null;
    }
    if (sticky_header_disposable !== null) {
        // Sticky header provider already exists, nothing to do.
        return;
    }
    let header_symbol_provider = new StickyHeaderProvider();
    let document_selector = [];
    for (let language_id in dialect_map) {
        if (dialect_map.hasOwnProperty(language_id)) {
            document_selector.push({language: language_id});
        }
    }
    sticky_header_disposable = vscode.languages.registerDocumentSymbolProvider(document_selector, header_symbol_provider);
}


function enable_dynamic_semantic_tokenization() {
    // Some themes can disable semantic highlighting e.g. "Tokyo Night" https://marketplace.visualstudio.com/items?itemName=enkia.tokyo-night, so we explicitly override the default setting in "configurationDefaults" section of package.json.
    // We also add all other csv dialects to "configurationDefaults":"editor.semanticHighlighting.enabled" override in order to enable comment line highlighting.
    // Conflict with some other extensions might also cause semantic highlighting to completely fail (although this could be caused by the theme issue described above), see https://github.com/mechatroner/vscode_rainbow_csv/issues/149.
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
    if (delim == 'TAB') {
        delim = '\t';
    }
    let policy = (delim == ',' || delim == ';') ? QUOTED_RFC_POLICY : SIMPLE_POLICY;
    return [delim, policy];
}


async function choose_dynamic_separator() {
    let log_wrapper = new StackContextLogWrapper('choose_dynamic_separator');
    let active_doc = get_active_doc();
    log_wrapper.log_doc_event('starting', active_doc);
    if (active_doc.languageId != DYNAMIC_CSV) {
        show_single_line_error('Dynamic separator can only be adjusted for "Dynamic CSV" filetype.');
        return;
    }
    let [delim, policy] = await get_dialect_from_user_dialog();
    if (!delim) {
        show_single_line_error('Unable to use empty string separator');
        return;
    }
    await save_dynamic_info(extension_context, active_doc.fileName, make_dialect_info(delim, policy));
    await enable_rainbow_features_if_csv(active_doc, log_wrapper);
}


function show_choose_dynamic_separator_button() {
    if (!dynamic_dialect_select_button)
        dynamic_dialect_select_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    dynamic_dialect_select_button.text = 'Choose Separator...';
    dynamic_dialect_select_button.tooltip = 'Click to choose Dynamic CSV separator';
    dynamic_dialect_select_button.command = 'rainbow-csv.ChooseDynamicSeparator';
    dynamic_dialect_select_button.show();
}

async function try_resolve_incomplete_dynamic_csv_dialect_if_needed(active_doc) {
    if (!active_doc || !active_doc.fileName) {
        return;
    }
    if (extension_context.dynamic_dialect_for_next_request != null) {
        // This branch has precedence over regular `get_dialect()` in the next branch because the same temp doc e.g. "Untitled-1" can be reused with a different dynamic dialect info that was previously set.
        await save_dynamic_info(extension_context, active_doc.fileName, extension_context.dynamic_dialect_for_next_request);
        extension_context.dynamic_dialect_for_next_request = null;
        return;
    }
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (delim && policy) {
        return; // All good.
    }
    [delim, policy] = await get_dialect_from_user_dialog();
    if (delim && policy) {
        await save_dynamic_info(extension_context, active_doc.fileName, make_dialect_info(delim, policy));
        return;
    }
    // Still no luck, show the button so that the user can at least complete the dialog later.
    show_choose_dynamic_separator_button();
}


async function enable_rainbow_features_if_csv(active_doc, log_wrapper) {
    log_wrapper.log_doc_event('start enable-rainbow-features-if-csv', active_doc);
    if (!is_rainbow_dialect_doc(active_doc)) {
        log_wrapper.log_simple_event('abort enable-rainbow-features-if-csv: non-rainbow dialect');
        return;
    }
    if (rainbow_on_status_bar_button) {
        rainbow_on_status_bar_button.hide();
    }
    var language_id = active_doc.languageId;
    if (language_id == DYNAMIC_CSV) {
        await try_resolve_incomplete_dynamic_csv_dialect_if_needed(active_doc);
    }
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (!delim || !policy) {
        // Make sure UI elements are disabled.
        log_wrapper.log_simple_event('abort enable-rainbow-features-if-csv: missing delim or policy');
        disable_ui_elements();
        return;
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
    enable_rainbow_ui(active_doc);
    await csv_lint(active_doc, false);
    log_wrapper.log_simple_event('finish enable-rainbow-features-if-csv');
}


function disable_ui_elements() {
    let all_buttons = [extension_context.lint_status_bar_button, rbql_status_bar_button, rainbow_off_status_bar_button, copy_back_button, align_shrink_button, column_info_button, dynamic_dialect_select_button];
    for (let i = 0; i < all_buttons.length; i++) {
        if (all_buttons[i])
            all_buttons[i].hide();
    }
    if (keyboard_cursor_subscription) {
        keyboard_cursor_subscription.dispose();
        keyboard_cursor_subscription = null;
    }
}


function disable_rainbow_features_if_non_csv(active_doc, log_wrapper) {
    log_wrapper.log_doc_event('start disable-rainbow-features-if-non-csv', active_doc);
    if (is_rainbow_dialect_doc(active_doc)) {
        if (rainbow_on_status_bar_button) {
            rainbow_on_status_bar_button.hide();
        }
        log_wrapper.log_simple_event('abort disable-rainbow-features-if-non-csv: is rainbow dialect');
        return;
    }
    if (is_eligible_doc(active_doc) && extension_context.reenable_rainbow_language_infos.has(active_doc.fileName)) {
        // Show "Rainbow On" button. The button will be hidden again if user clicks away by `disable_rainbow_features_if_non_csv`.
        // Only show for non-rainbow docs since this mechanism can interfere with manual filetype selection UI.
        show_rainbow_on_status_bar_button();
    } else {
        if (rainbow_on_status_bar_button) {
            rainbow_on_status_bar_button.hide();
        }
    }
    log_wrapper.log_simple_event('perform disable-rainbow-features-if-non-csv');
    disable_ui_elements();
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


function is_active_doc(vscode_doc) {
    let active_doc = get_active_doc();
    return (active_doc && active_doc.uri && vscode_doc && vscode_doc.uri && active_doc.uri.toString() == vscode_doc.uri.toString());
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
    if (!header) {
        return null;
    }
    let [_full_text, short_report] = ll_rainbow_utils().format_cursor_position_info(cursor_position_info, header, enable_tooltip_column_names, /*show_comments=*/true, /*max_label_length=*/25);
    let mds = new vscode.MarkdownString();
    // Using a special pseudo-language grammar trick for highlighting the hover text using the same color as the column doesn't work anymore due to https://github.com/microsoft/vscode/issues/53723.
    mds.appendText(short_report);
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
    if (!header)
        return false;
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


function show_rainbow_on_status_bar_button() {
    if (!rainbow_on_status_bar_button)
        rainbow_on_status_bar_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    rainbow_on_status_bar_button.text = 'Rainbow ON';
    rainbow_on_status_bar_button.tooltip = 'Click to reenable Rainbow CSV for this file';
    rainbow_on_status_bar_button.command = 'rainbow-csv.RainbowSeparatorOn';
    rainbow_on_status_bar_button.show();
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
    if (!is_rainbow_dialect_doc(active_doc)) {
        return null;
    }
    var file_path = active_doc.fileName; // For new untitled scratch documents this would be "Untitled-1", "Untitled-2", etc...
    var language_id = active_doc.languageId;
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



function command_async_wrapper(cmd, args) {
    return new Promise(function (resolve, reject) {
        let stdout_data = '';
        let stderr_data = '';
        let process = child_process.spawn(cmd, args, {'windowsHide': true});
        process.stdout.on('data', function(data) {
            stdout_data += data.toString();
        });
        process.stderr.on('data', function(data) {
            stderr_data += data.toString();
        });
        process.on('close', function (code) { // Consider replacing 'close' with 'exit'.
            resolve({'exit_code': code, 'stdout': stdout_data, 'stderr': stderr_data});
        });
        process.on('error', function (err) {
            reject(err);
        });
    });
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


async function run_command_and_parse_output(cmd, args) {
    let execution_result = null;
    try {
        execution_result = await command_async_wrapper(cmd, args);
    } catch (error) {
        let error_details = error ? error.name + ': ' + error.message : '';
        let error_msg = 'Something went wrong. Make sure you have python installed and added to PATH variable in your OS. Or you can use it with JavaScript instead - it should work out of the box\nDetails:\n' + error_details;
        return {error_type: 'Integration', error_msg: error_msg, invocation_error: 1};
    }
    let json_report = execution_result.stdout;
    if (!json_report || execution_result.stderr) {
        let error_msg = execution_result.stderr || 'empty error';
        return {error_type: 'Integration', error_msg: error_msg};
    }
    try {
        return JSON.parse(json_report);
    } catch (e) {
        return {error_type: 'Integration', error_msg: 'Unable to parse JSON report'};
    }
}


async function run_first_working_interpreter_command_and_parse_output(interpreters_list, args, log_wrapper) {
    // The main use case of this function is to try 'python3' first and then fall back to 'python' if 'python3' is unavailable for some reason.
    let execution_result = null;
    for (let interpreter_cmd of interpreters_list) {
        log_wrapper.log_simple_event(`Attempting interpreter '${interpreter_cmd}' ...`);
        execution_result = await run_command_and_parse_output(interpreter_cmd, args);
        if (!execution_result || !execution_result.hasOwnProperty('invocation_error') || !execution_result.invocation_error) {
            return execution_result;
        }
        log_wrapper.log_simple_event(`Interpreter '${interpreter_cmd}' invocation failed.`);
    }
    return execution_result;
}


async function send_report_to_webview(webview, error_type, error_msg) {
    let report_msg = {'msg_type': 'rbql_report'};
    if (error_type)
        report_msg["error_type"] = error_type;
    if (error_msg)
        report_msg["error_msg"] = error_msg;
    _unit_test_last_rbql_report = report_msg;
    await webview.postMessage(report_msg);
}


async function run_rbql_query(webview, input_path, csv_encoding, backend_language, rbql_query, output_dialect, with_headers) {
    // TODO refactor this function.
    let log_wrapper = new StackContextLogWrapper('run-rbql-query');
    log_wrapper.log_simple_event('start');
    last_rbql_queries.set(file_path_to_query_key(input_path), rbql_query);
    let interpreters_preference_list = ['python3', 'python'];
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
        log_wrapper.log_simple_event('test mode');
        // interpreters_preference_list = ['nopython', 'python3', 'python']; // interpreters_preference_list can be adjusted for testing
        let args = [absolute_path_map['rbql mock/rbql_mock.py'], rbql_query];
        let execution_result = await run_first_working_interpreter_command_and_parse_output(interpreters_preference_list, args, log_wrapper);
        console.log(JSON.stringify(execution_result));
        if (execution_result.hasOwnProperty('error_type') || execution_result.hasOwnProperty('error_msg')) {
            await send_report_to_webview(webview, execution_result.error_type, execution_result.error_msg);
            return;
        }
        await send_report_to_webview(webview, null, null);
        return;
    }
    if (backend_language == 'js') {
        log_wrapper.log_simple_event('using js backend');
        let warnings = [];
        let result_doc = null;
        let target_language_id = map_dialect_to_language_id(output_delim, output_policy);
        try {
            if (is_web_ext) {
                log_wrapper.log_simple_event('using web mode');
                let result_lines = await ll_rainbow_utils().rbql_query_web(rbql_query, rbql_context.input_document, input_delim, input_policy, output_delim, output_policy, warnings, with_headers, comment_prefix);
                let output_doc_cfg = {content: result_lines.join('\n'), language: target_language_id};
                if (target_language_id == DYNAMIC_CSV) {
                    extension_context.dynamic_dialect_for_next_request = make_dialect_info(output_delim, output_policy);
                }
                extension_context.autodetection_temporarily_disabled_for_rbql = true;
                result_doc = await vscode.workspace.openTextDocument(output_doc_cfg);
                await send_report_to_webview(webview, null, null);
                await handle_rbql_result_file_web(result_doc, warnings);
                extension_context.dynamic_dialect_for_next_request = null;
                extension_context.autodetection_temporarily_disabled_for_rbql = false;
                log_wrapper.log_simple_event('finished OK');
            } else {
                log_wrapper.log_simple_event('using electron mode');
                let csv_options = {'bulk_read': true};
                await ll_rainbow_utils().rbql_query_node(global_state, rbql_query, input_path, input_delim, input_policy, output_path, output_delim, output_policy, csv_encoding, warnings, with_headers, comment_prefix, /*user_init_code=*/'', csv_options);
                result_set_parent_map.set(safe_lower(output_path), input_path);
                if (target_language_id == DYNAMIC_CSV) {
                    extension_context.dynamic_dialect_for_next_request = make_dialect_info(output_delim, output_policy);
                }
                extension_context.autodetection_temporarily_disabled_for_rbql = true;
                result_doc = await vscode.workspace.openTextDocument(output_path);
                await send_report_to_webview(webview, null, null);
                await handle_rbql_result_file_node(result_doc, output_delim, output_policy, warnings);
                extension_context.dynamic_dialect_for_next_request = null;
                extension_context.autodetection_temporarily_disabled_for_rbql = false;
                log_wrapper.log_simple_event('finished OK');
            }
        } catch (e) {
            let [error_type, error_msg] = ll_rbql_csv().exception_to_error_info(e);
            log_wrapper.log_simple_event('finished with error');
            await send_report_to_webview(webview, error_type, error_msg);
            return;
        }
    } else {
        log_wrapper.log_simple_event('using python backend');
        if (is_web_ext) {
            await send_report_to_webview(webview, 'Input error', 'Python backend for RBQL is not supported in web version, please use JavaScript backend.');
            return;
        }
        let cmd_safe_query = Buffer.from(rbql_query, "utf-8").toString("base64");
        if (!comment_prefix) {
            comment_prefix = '';
        }
        let args = [absolute_path_map['rbql_core/vscode_rbql.py'], cmd_safe_query, input_path, input_delim, input_policy, output_path, output_delim, output_policy, comment_prefix, csv_encoding];
        if (with_headers)
            args.push('--with_headers');
        let execution_result = await run_first_working_interpreter_command_and_parse_output(interpreters_preference_list, args, log_wrapper);
        if (execution_result.hasOwnProperty('error_type') || execution_result.hasOwnProperty('error_msg')) {
            log_wrapper.log_simple_event('finished with error');
            await send_report_to_webview(webview, execution_result.error_type, execution_result.error_msg);
            return;
        }
        log_wrapper.log_simple_event('finished OK');
        await send_report_to_webview(webview, null, null);
        extension_context.autodetection_stoplist.add(output_path);
        result_set_parent_map.set(safe_lower(output_path), input_path);
        extension_context.autodetection_temporarily_disabled_for_rbql = true;
        let target_language_id = map_dialect_to_language_id(output_delim, output_policy);
        let output_doc = await vscode.workspace.openTextDocument(output_path);
        extension_context.autodetection_temporarily_disabled_for_rbql = false;
        // We need dynamic_dialect_for_next_request here because we can't open the output_doc with DYNAMIC_CSV, it will be switched on doc-ropen.
        if (target_language_id == DYNAMIC_CSV) {
            extension_context.dynamic_dialect_for_next_request = make_dialect_info(output_delim, output_policy);
        }
        await handle_rbql_result_file_node(output_doc, output_delim, output_policy, execution_result.warnings);
        extension_context.dynamic_dialect_for_next_request = null;
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
    let header_line = selection.start.line;
    let raw_header = active_doc.lineAt(header_line).text;
    let header = csv_utils.smart_split(raw_header, delim, policy, false)[0];

    // The advantage of saving the parsed list of column names is that it would stay consistent even if some lines are added/deleted before the header line (line migration).
    // The advantage of saving the line number is that it is resilient to modifications of header line itself.
    // It is also possible to verify consistency of header line and header column names and return null if they are inconsistent and return null.
    // But discarding the inconsistent header line is probably not very obvious and user-friendly way of handling this.
    // Showing the inconsistent header is probably better since these column names are only used for UI/readability and a wrong sticky line obviously hints on what happened and how to fix it, while a suddenly disappeared sticky line could be seen as a bug.
    await save_to_global_state(make_header_key(file_path), {header_line_num: header_line, header: header});
    // Re-register sticky header provider because otherwise it won't re-generate the symbols unless there were no edits to the file.
    reconfigure_sticky_header_provider(/*force=*/true);
}


function preserve_original_language_id_if_needed(file_path, original_language_id, original_language_ids) {
    if (!file_path) {
        return;
    }
    if (dialect_map.hasOwnProperty(original_language_id)) {
        // This is to prevent invalid noop "dynamic csv" -> "dynamic csv" switch without carying dialect info.
        // And to simplify state management in general by not storing any rainbow dialects.
        return;
    }
    original_language_ids.set(file_path, original_language_id);
}


async function manually_set_rainbow_separator(policy=null) {
    // The effect of manually setting the separator will disapear in the preview mode when the file is toggled in preview tab: see https://code.visualstudio.com/docs/getstarted/userinterface#_preview-mode
    // Also the effect may disappear in case of "curious doc reopening" problem, see DEV_README for more info.
    let active_editor = get_active_editor();
    if (!active_editor)
        return;
    var active_doc = get_active_doc(active_editor);
    if (!is_eligible_doc(active_doc)) {
        return;
    }
    let selection = active_editor.selection;
    if (!selection) {
        show_single_line_error("Selection is empty: separator must be selected with the editor cursor");
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
    let original_language_id = active_doc.languageId;
    if (original_language_id == DYNAMIC_CSV && language_id == DYNAMIC_CSV) {
        // We need to somehow explicitly re-tokenize file, because otherwise setTextDocumentLanguage would be a NO-OP, so we do this workaround with temporarily switching to plaintext and back.
        extension_context.autodetection_stoplist.add(active_doc.fileName); // This is to avoid potential autodetection in plaintext.
        extension_context.autodetection_temporarily_disabled_for_rbql = true;
        active_doc = await vscode.languages.setTextDocumentLanguage(active_doc, 'plaintext');
        extension_context.autodetection_temporarily_disabled_for_rbql = false;
    }
    if (language_id == DYNAMIC_CSV) {
        await save_dynamic_info(extension_context, active_doc.fileName, make_dialect_info(separator, policy));
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
    let log_wrapper = new StackContextLogWrapper('restore_original_language');
    let active_doc = get_active_doc();
    log_wrapper.log_doc_event('starting', active_doc);
    if (!active_doc)
        return;
    let file_path = active_doc.fileName;
    let original_language_id = 'plaintext';
    if (extension_context.original_language_ids.has(file_path)) {
        original_language_id = extension_context.original_language_ids.get(file_path);
    }
    if (dialect_map.hasOwnProperty(original_language_id) || !dialect_map.hasOwnProperty(active_doc.languageId)) {
        show_single_line_error("Unable to restore original language");
        return;
    }

    if (file_path) {
        // Preserve rainbow language info, so that the user can later re-enable it for this file.
        let current_language_info = {language_id: active_doc.languageId};
        let dynamic_dialect_info = get_dynamic_info(file_path);
        if (dynamic_dialect_info) {
            current_language_info.dynamic_dialect_info = dynamic_dialect_info;
        }
        extension_context.reenable_rainbow_language_infos.set(file_path, current_language_info);
        extension_context.autodetection_stoplist.add(file_path);
    }

    active_doc = await vscode.languages.setTextDocumentLanguage(active_doc, original_language_id);
    // There is no onDidChangeActiveTextEditor even for language change so we need to explicitly disable rainbow features.
    disable_rainbow_features_if_non_csv(active_doc, log_wrapper);
    // The only reason why we might want to clean up dynamic dialect info here is to facilitate triggering dynamic_document_dialect selection UI after manual filetype swith at the later point so that the user could choose a different dynamic dialect without manual selection by cursor / commands.
    remove_dynamic_info(file_path);
}


async function reenable_rainbow_language() {
    var active_doc = get_active_doc();
    if (!active_doc)
        return;
    let file_path = active_doc.fileName;
    if (!extension_context.reenable_rainbow_language_infos.has(file_path)) {
        // Make sure we have previous rainbow dialect saved.
        show_single_line_error("Unable to re-enable rainbow highlighting automatically, select filetype manually or select a new separator with cursor.");
        return;
    }
    let rainbow_language_info = extension_context.reenable_rainbow_language_infos.get(file_path);
    // Delete from the stoplist to revert "Rainbow Off" side-effects.
    extension_context.autodetection_stoplist.delete(file_path);
    if (rainbow_language_info.hasOwnProperty('dynamic_dialect_info')) {
        await save_dynamic_info(extension_context, file_path, rainbow_language_info.dynamic_dialect_info);
    }
    // Preserve current (non-rainbow) language id to allow switching between "Rainbow Off"/"Rainbow On".
    preserve_original_language_id_if_needed(file_path, active_doc.languageId, extension_context.original_language_ids);
    // Delete from the "reenable" map to hide the "Rainbow ON" button on next refresh.
    extension_context.reenable_rainbow_language_infos.delete(file_path);
    if (rainbow_on_status_bar_button) {
        // Hide the button explicitly.
        rainbow_on_status_bar_button.hide();
    }
    let doc = await vscode.languages.setTextDocumentLanguage(active_doc, rainbow_language_info.language_id);
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
    var old_header_str = old_header ? quoted_join(old_header, delim) : '';
    var input_box_props = {"prompt": title, "value": old_header_str};
    let raw_new_header = await vscode.window.showInputBox(input_box_props);
    if (!raw_new_header)
        return; // User pressed Esc and closed the input box.
    let new_header = csv_utils.smart_split(raw_new_header, delim, policy, false)[0];
    await save_to_global_state(make_header_key(file_path), {header_line_num: null, header: new_header});
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
    if (!is_rainbow_dialect_doc(active_doc)) {
        return;
    }
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (policy === null) {
        return;
    }
    let progress_options = {location: vscode.ProgressLocation.Window, title: 'Rainbow CSV'};
    await vscode.window.withProgress(progress_options, async (progress) => {
        await report_progress(progress, 'Preparing');
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
        await report_progress(progress, 'Shrinking columns');
        await replace_doc_content(active_editor, active_doc, shrinked_doc_text);
    });
}


async function align_table() {
    let active_editor = get_active_editor();
    let active_doc = get_active_doc(active_editor);
    if (!is_rainbow_dialect_doc(active_doc))
        return;
    let [delim, policy, comment_prefix] = get_dialect(active_doc);
    if (policy === null) {
        return;
    }
    let progress_options = {location: vscode.ProgressLocation.Window, title: 'Rainbow CSV'};
    await vscode.window.withProgress(progress_options, async (progress) => {
        await report_progress(progress, 'Calculating column statistics');
        let double_width_alignment = get_from_config('double_width_alignment', true);
        let [column_stats, first_failed_line, records, comments] = ll_rainbow_utils().calc_column_stats(active_doc, delim, policy, comment_prefix, double_width_alignment);
        if (first_failed_line) {
            show_single_line_error(`Unable to align: Inconsistent double quotes at line ${first_failed_line}`);
            return;
        }
        column_stats = ll_rainbow_utils().adjust_column_stats(column_stats, delim.length);
        if (column_stats === null) {
            show_single_line_error('Unable to allign: Internal Rainbow CSV Error');
            return;
        }
        await report_progress(progress, 'Preparing final alignment');
        let aligned_doc_text = ll_rainbow_utils().align_columns(records, comments, column_stats, delim);

        await report_progress(progress, 'Aligning columns');
        let align_in_scratch_file = get_from_config('align_in_scratch_file', false);
        let is_scratch_file = active_doc.uri && active_doc.uri.scheme == 'untitled';
        if (align_in_scratch_file && !is_scratch_file) {
            let aligned_doc_cfg = {content: aligned_doc_text, language: active_doc.languageId};
            let scratch_doc = await vscode.workspace.openTextDocument(aligned_doc_cfg);
            aligned_files.add(scratch_doc.fileName);
            await vscode.window.showTextDocument(scratch_doc);
            show_align_shrink_button(scratch_doc.fileName); // This is likely redundant but won't hurt.
        } else {
            await replace_doc_content(active_editor, active_doc, aligned_doc_text);
            aligned_files.add(active_doc.fileName);
            show_align_shrink_button(active_doc.fileName);
        }
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
        init_msg['header_for_ui'] = rbql_context.header_for_ui;
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
            if (!header_line) {
                return;
            }
            let [fields, warning] = csv_utils.smart_split(header_line, rbql_context.delim, rbql_context.policy, false);
            if (!warning) {
                webview.postMessage({'msg_type': 'fetch_table_header_response', 'header_for_ui': fields});
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
        await run_rbql_query(webview, rbql_context.input_document_path, encoding, backend_language, rbql_query, output_dialect, with_headers);
    }

    if (message_type == 'edit_udf') {
        if (is_web_ext) {
            await send_report_to_webview(webview, 'Input error', 'UDFs are currently not supported in web version');
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
    let header_for_ui = get_header_from_document(active_doc, delim, policy, comment_prefix);
    rbql_context = {
        "input_document": active_doc,
        "input_document_path": input_path,
        "requested_start_record": 0,
        "delim": delim,
        "policy": policy,
        "comment_prefix": comment_prefix,
        "with_headers": with_headers,
        "header_for_ui": header_for_ui
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


async function try_autodetect_and_set_rainbow_filetype(vscode, config, extension_context, active_doc, logging_context_id=null) {
    // VSCode to some extent is capable of "remembering" doc id in the previous invocation, at least when used in debug mode.

    // VSCode may (and will?) forget documentId of a document "A" if document "B" is opened in the tab where "A" was (double VS single click in file browser panel).
    // see https://code.visualstudio.com/docs/getstarted/userinterface#_preview-mode
    let log_wrapper = new StackContextLogWrapper('autodetection', logging_context_id);
    log_wrapper.log_doc_event('starting...', active_doc);
    if (extension_context.autodetection_temporarily_disabled_for_rbql) {
        log_wrapper.log_simple_event('abort: disabled for rbql');
        return [active_doc, false];
    }
    if (!is_eligible_doc(active_doc)) {
        log_wrapper.log_simple_event('abort: ineligible doc');
        return [active_doc, false];
    }
    if (!get_from_config('enable_separator_autodetection', false, config)) {
        log_wrapper.log_simple_event('abort: disabled in config');
        return [active_doc, false];
    }
    var file_path = active_doc.fileName;
    var original_language_id = active_doc.languageId;
    if (extension_context.autodetection_stoplist.has(file_path)) {
        log_wrapper.log_simple_event('abort: doc path in stoplist');
        return [active_doc, false];
    }
    // The check below also prevents double autodetection from handle_doc_open fork in the new_doc with adjusted language id.
    let is_default_csv = (file_path.endsWith('.csv') || file_path.endsWith('.CSV')) && original_language_id == 'csv';
    if (original_language_id != 'plaintext' && !is_default_csv) {
        log_wrapper.log_simple_event('abort: ineligible original language id');
        return [active_doc, false];
    }

    let candidate_separators = get_from_config('autodetect_separators', [], config).map((s) => s === 'TAB' ? '\t' : s);
    if (!dialect_map.hasOwnProperty(original_language_id) &&
        last_closed_rainbow_doc_info &&
        last_closed_rainbow_doc_info.file_path === file_path &&
        Math.abs(Date.now() - last_closed_rainbow_doc_info.timestamp) < 1000) {
        // The same file was recently closed with rainbow dialect and re-opened as another filetype, most likely manual language switch, do not autodetect.
        // Do not add to autodetection_stoplist because it goes against VSCode approach to discard all language mode state on reopen.
        // Also adding to autodetection_stoplist would make "curious doc reopening" problem worse.
        // Do not initialize "Rainbow ON" because either it was already enabled or user goes through the native UI and therefore showing Rainbow ON is not idiomatic/consistent/relevant.
        log_wrapper.log_simple_event('abort: recent doc language switch prevention');
        return [active_doc, false];
    }

    let comment_prefix_for_autodetection = get_from_config('comment_prefix', '', config) || '#'; // Assume '#' as a comment prefix for autodetection purposes only.
    log_wrapper.log_simple_event('starting standard dialect autodetection...');
    let [rainbow_csv_language_id, delim, policy, first_trailing_space_line] = autodetect_dialect(config, active_doc, candidate_separators, comment_prefix_for_autodetection);
    if (rainbow_csv_language_id) {
        // Add the file to lint results to avoid re-parsing it with CSV Lint later.
        extension_context.lint_results.set(`${file_path}.${rainbow_csv_language_id}`, {'is_ok': true, 'first_trailing_space_line': first_trailing_space_line});
    } else if (!rainbow_csv_language_id && is_default_csv) {
        // Smart autodetection method has failed, but we need to choose a separator because this is a csv file. Let's just find the most popular one within the first N characters.
        log_wrapper.log_simple_event('starting frequency-based dialect autodetection...');
        [rainbow_csv_language_id, delim, policy] = autodetect_dialect_frequency_based(active_doc, candidate_separators, /*max_num_chars_to_test=*/10000);
    }
    if (!rainbow_csv_language_id) {
        log_wrapper.log_simple_event('abort: content-based autodetection did not detect anything');
        return [active_doc, false];
    }
    // Intentionally do not store comment prefix used for autodetection in the dialect info since it is not file-specific anyway and is stored in the settings.
    // And in case if user changes it in the settings it would immediately affect the autodetected files.
    if (rainbow_csv_language_id == DYNAMIC_CSV) {
        await save_dynamic_info(extension_context, file_path, make_dialect_info(delim, policy), extension_context);
    }
    if (rainbow_csv_language_id == original_language_id) {
        log_wrapper.log_simple_event('abort: autodetected dialect matches the original one');
        return [active_doc, false];
    }

    // We can't add the doc path to autodetection_stoplist here (for autodetect-once semantic)
    // because the doc could be in preview mode and VSCode won't remember language_id so we might need to autodetect it again later.

    preserve_original_language_id_if_needed(file_path, original_language_id, extension_context.original_language_ids);
    log_wrapper.log_simple_event(`autodetection successful - switching from ${original_language_id} to ${rainbow_csv_language_id}`);
    let new_doc = await vscode.languages.setTextDocumentLanguage(active_doc, rainbow_csv_language_id);
    log_wrapper.log_doc_event('after language switch', new_doc);
    return [new_doc, true];
}


async function handle_first_edit_for_an_empty_doc(change_event) {
    if (!change_event)
        return;
    if (doc_first_edit_subscription) {
        doc_first_edit_subscription.dispose();
        doc_first_edit_subscription = null;
    }
    let log_wrapper = new StackContextLogWrapper('handle_first_edit_for_an_empty_doc');
    log_wrapper.log_doc_event('starting', change_event.document);
    await try_autodetect_and_set_rainbow_filetype(vscode, vscode.workspace.getConfiguration('rainbow_csv'), extension_context, change_event.document, log_wrapper.context_id);
}


async function handle_editor_switch(editor) {
    let log_wrapper = new StackContextLogWrapper('handle_editor_switch');
    // This event is not triggered when language mode is changed.
    // We need this handler to hide and show UI elements when user switches between the doc tabs.
    // When the file is larger than 50MB, editor and active_doc are null/undefined.
    let active_doc = get_active_doc(editor);
    log_wrapper.log_doc_event('editor switch', active_doc);
    // When switching between the open non-preview doc tabs the doc open/close events are (typically) not triggered for the actual files (exception is "curious doc reopening" problem, see DEV_README.md)
    // but open and close events could (and will) be triggered for some virtual files e.g. paired files with .git scheme.
    disable_rainbow_features_if_non_csv(active_doc, log_wrapper);
    await enable_rainbow_features_if_csv(active_doc, log_wrapper); // No-op if non-csv.
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


async function handle_doc_open(new_doc) {
    // The onDidOpenTextDocument handler will trigger for already "opened" docs too if they are re-opened in the same tab. Example
    // Document "A" opens in tab1 -> triggers onDidOpenTextDocument
    // Document "B" opens in tab1 -> triggers onDidOpenTextDocument  (this could happen if user clicks on document "B" in the left file browser panel)
    // Document "A" opens in tab1 -> triggers onDidOpenTextDocument again! The previous languageId is reset.
    // In other words if user opens a different document in the same tab (single click VS double click in the file browser panel) it may trigger the curent document closing and opening of a new doc.
    // This behavior is called Preview Mode, see https://vscode.one/new-tab-vscode/ and https://code.visualstudio.com/docs/getstarted/userinterface#_preview-mode

    let log_wrapper = new StackContextLogWrapper('handle_doc_open');
    log_wrapper.log_doc_event('opening doc', new_doc);

    if (!is_eligible_doc(new_doc)) {
        log_wrapper.log_simple_event('abort: ineligible doc');
        return;
    }

    // Register a handler for copy-pasting CSV-formated data into an empty doc. Empty docs have lineCount equal 1.
    if (get_from_config('enable_separator_autodetection', false) && doc_first_edit_subscription === null && new_doc.isUntitled && new_doc.lineCount <= 1) {
        doc_first_edit_subscription = vscode.workspace.onDidChangeTextDocument(handle_first_edit_for_an_empty_doc);
        log_wrapper.log_simple_event('creating empty doc subscription');
        return;
    }
    let filetype_changed = false;
    [new_doc, filetype_changed] = await try_autodetect_and_set_rainbow_filetype(vscode, vscode.workspace.getConfiguration('rainbow_csv'), extension_context, new_doc, log_wrapper.context_id);

    // If autodetection was successful we are essentially forking this handler for the new doc and the code below will be executed twice: here and in the handle_doc_open for the `new_doc`.
    // There is still some benefit for not having and additional check to prevent this double execution: disable/enable ui calls are idempotent and the code is more robust/reliable this way.
    log_wrapper.log_doc_event(`after autodetection. filetype changed: ${filetype_changed}`, new_doc);
    // There might be some redundancy between this code and onDidChangeActiveTextEditor handler, but this actually desired as long as methods are idempotent.
    // It is much better to do the same thing twice (if it is idempotent) to ensure the required behavior than rely on assumptions about external VSCode mechanisms (aka Defensive Programming).
    if (is_active_doc(new_doc)) {
        log_wrapper.log_simple_event('active doc - enabling features');
        disable_rainbow_features_if_non_csv(new_doc, log_wrapper); // We need this to handle manual switch from csv to txt, this would immediately remove UI elements, that would stay otherwise.
        await enable_rainbow_features_if_csv(new_doc, log_wrapper); // No-op if non-csv.
    }
    log_wrapper.log_simple_event('finishing');
}


async function handle_doc_close(doc_to_close) {
    // NOTE: Closing of doc A (csv) followed by opening of the same doc A (non-csv) can also be caused by the "curious doc reopening" problem, see DEV_README.md.

    // This is a workaround hack to prevent repeated autodetection on csv -> txt language switch.
    // In that case a csv file will be closed and shortly after a txt file with the same path will be opened, so we don't want to apply autodetection to it.
    // This will also trigger when virtual docs (e.g. `.git` pairs) are closed, but it is probably fine to reset last_closed_rainbow_doc_info in that case.
    let log_wrapper = new StackContextLogWrapper('handle_doc_close');
    log_wrapper.log_doc_event('closing doc', doc_to_close);
    if (!is_rainbow_dialect_doc(doc_to_close)) {
        log_wrapper.log_simple_event('abort: non rainbow doc');
        last_closed_rainbow_doc_info = null;
        return;
    }

    last_closed_rainbow_doc_info = {file_path: doc_to_close.fileName, timestamp: Date.now()};

    if (is_active_doc(doc_to_close)) {
        log_wrapper.log_simple_event('disabling ui elements');
        // In order to disable elements we need to check that the closed rainbow doc is in fact active doc to avoid removing UI when a non-focused CSV or non-csv file is being closed.
        // Inactive CSV closing can happen in the background if user closes with "x" top-right corner button another inactive tab with another CSV file.
        disable_ui_elements();
    }
    log_wrapper.log_simple_event('finalizing');
}

async function handle_config_change(config_change_event) {
    // Here `config_change_event` allows to check if a specific configuration was affected but another way to do this is just to compare before and after values.
    let logging_enabled_before = extension_context.logging_enabled;
    extension_context.logging_enabled = get_from_config('enable_debug_logging', false);
    if (extension_context.logging_enabled && !logging_enabled_before) {
        let log_wrapper = new StackContextLogWrapper('config change');
        log_wrapper.log_simple_event('logging enabled');
    }
    reconfigure_sticky_header_provider();
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
                builder.push(row_info.comment_range, COMMENT_TOKEN);
            } else {
                for (let col_num = 0; col_num < row_info.record_ranges.length; col_num++) {
                    for (let record_range of row_info.record_ranges[col_num]) {
                        // One logical field can map to multiple tokens if it spans multiple lines because VSCode doesn't support multiline tokens.
                        builder.push(record_range, rainbow_token_types[col_num % rainbow_token_types.length]);
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
                builder.push(new vscode.Range(lnum, 0, lnum, line_text.length), COMMENT_TOKEN);
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
    extension_context.logging_enabled = get_from_config('enable_debug_logging', false);

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
    var rainbow_on_cmd = vscode.commands.registerCommand('rainbow-csv.RainbowSeparatorOn', reenable_rainbow_language);
    var sample_head_cmd = vscode.commands.registerCommand('rainbow-csv.SampleHead', async function(uri) { await make_preview(uri, 'head'); }); // WEB_DISABLED
    var sample_tail_cmd = vscode.commands.registerCommand('rainbow-csv.SampleTail', async function(uri) { await make_preview(uri, 'tail'); }); // WEB_DISABLED
    var align_cmd = vscode.commands.registerCommand('rainbow-csv.Align', align_table);
    var shrink_cmd = vscode.commands.registerCommand('rainbow-csv.Shrink', shrink_table);
    var copy_back_cmd = vscode.commands.registerCommand('rainbow-csv.CopyBack', copy_back); // WEB_DISABLED
    var internal_test_cmd = vscode.commands.registerCommand('rainbow-csv.InternalTest', run_internal_test_cmd);

    // INFO: vscode.workspace and vscode.window lifetime are likely guaranteed to cover the extension lifetime (period between activate() and deactivate()) but I haven't found a confirmation yet.
    var doc_open_event = vscode.workspace.onDidOpenTextDocument(handle_doc_open);
    var doc_close_event = vscode.workspace.onDidCloseTextDocument(handle_doc_close);
    var config_change_event = vscode.workspace.onDidChangeConfiguration(handle_config_change);

    var switch_event = vscode.window.onDidChangeActiveTextEditor(handle_editor_switch);
    try {
        debug_log_output_channel = vscode.window.createOutputChannel('rainbow_csv_debug_channel', {log: true});
    } catch (error) {
        console.error('Rainbow CSV: Failed to create output log channel');
    }

    enable_dynamic_semantic_tokenization();
    reconfigure_sticky_header_provider();

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
    context.subscriptions.push(rainbow_on_cmd);
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
    context.subscriptions.push(doc_close_event);
    context.subscriptions.push(switch_event);
    context.subscriptions.push(config_change_event);


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
exports.try_autodetect_and_set_rainbow_filetype = try_autodetect_and_set_rainbow_filetype;
