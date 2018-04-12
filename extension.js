const vscode = require('vscode');

var rainbow_utils = require('./rainbow_utils');

var dialect_map = {'csv': [',', 'quoted'], 'tsv': ['\t', 'simple'], 'csv (semicolon)': [';', 'quoted']};

var oc_log = null; // For debug

var lint_results = new Map();
var rbql_origin = null;
var sb_item = null;

var rbql_provider = null;


function sample_preview_records(document, window_center, window_size, delim, policy) {
    var adjusted_window = rainbow_utils.adjust_window_borders(window_center, window_size, document.lineCount);
    var line_begin = adjusted_window[0];
    var line_end = adjusted_window[1];
    preview_records = [];
    var max_cols = 0;
    for (var nr = line_begin; nr < line_end; nr++) {
        var line_text = document.lineAt(nr).text;
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


function guess_document_header(document, delim, policy) {
    var sampled_records = [];
    var num_lines = document.lineCount;
    var head_count = 10;
    if (num_lines <= head_count * 2) {
        for (var i = 1; i < num_lines; i++) {
            sampled_records.push(rainbow_utils.smart_split(document.lineAt(i).text, delim, policy, false)[0]);
        }
    } else {
        for (var i = 1; i < head_count; i++) {
            sampled_records.push(rainbow_utils.smart_split(document.lineAt(i).text, delim, policy, false)[0]);
        }
        for (var i = num_lines - head_count; i < num_lines; i++) {
            sampled_records.push(rainbow_utils.smart_split(document.lineAt(i).text, delim, policy, false)[0]);
        }
    }
    while (sampled_records.length) {
        var last = sampled_records[sampled_records.length - 1];
        if (last.length != 1 || last[0] != "")
            break;
        sampled_records.pop();
    }
    if (sampled_records.length < 10)
        return null;
    var potential_header = rainbow_utils.smart_split(document.lineAt(0).text, delim, policy, false)[0];
    var has_header = rainbow_utils.guess_if_header(potential_header, sampled_records);
    return has_header ? potential_header : null;
}


function make_hover_text(document, position, language_id) {
    var delim = dialect_map[language_id][0];
    var policy = dialect_map[language_id][1];
    var lnum = position.line;
    var cnum = position.character;
    var line = document.lineAt(lnum).text;

    var report = rainbow_utils.smart_split(line, delim, policy, false);

    var entries = report[0];
    var warning = report[1];
    var col_num = rainbow_utils.get_field_by_line_position(entries, cnum + 1);

    if (col_num == null)
        return null;
    var result = 'col# ' + (col_num + 1);
    if (warning)
        return result + '; This line has quoting error!';
    var header = guess_document_header(document, delim, policy);
    if (header !== null && header.length == entries.length) {
        var column_name = header[col_num];
        result += ', "' + column_name + '"';
    }
    return result;
}


function make_hover(document, position, language_id, cancellation_token) {
    setTimeout(function() { 
        if (csv_lint(true, document)) {
            show_linter_state();
        }
    });
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


function get_active_doc() {
    var active_window = vscode.window;
    if (!active_window)
        return null;
    var active_editor = active_window.activeTextEditor;
    if (!active_editor)
        return null;
    var active_doc = active_editor.document;
    if (!active_doc)
        return null;
    return active_doc;
}


function csv_lint_cmd() {
    csv_lint(false, null);
    // Need timeout here to give user enough time to notice green -> yellow -> green switch, this is a sort of visual feedback
    setTimeout(show_linter_state, 500);
}


function handle_preview_success(success) {
    oc_log.appendLine('preview success!');
}


function handle_preview_error(reason) {
    oc_log.appendLine('preview failure!');
    oc_log.appendLine(reason);
    vscode.window.showErrorMessage('Unable to create query window.\nReason: ' + reason);
}


function edit_rbql() {
    // TODO show error instead of silent exit
    var active_window = vscode.window;
    if (!active_window)
        return null;
    var active_editor = active_window.activeTextEditor;
    if (!active_editor)
        return null;
    var active_doc = active_editor.document;
    if (!active_doc)
        return null;
    var orig_uri = active_doc.uri;
    if (!orig_uri || orig_uri.scheme != 'file')
        return;
    var language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    var cursor_line = active_editor.selection.isEmpty ? active_editor.selection.active.line : 0;
    rbql_origin = {"document": active_doc, "line": cursor_line};
    var rbql_uri = vscode.Uri.parse('rbql://authority/rbql');
    vscode.commands.executeCommand('vscode.previewHtml', rbql_uri, undefined, 'RBQL Dashboard').then(handle_preview_success, handle_preview_error);
}


function csv_lint(autolint, active_doc) {
    if (autolint) {
        const config = vscode.workspace.getConfiguration('rainbow_csv');
        if (config && config.get('enable_auto_csv_lint') === false)
            return false;
    }
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
    if (autolint && lint_results.has(file_path))
        return false;
    lint_results.set(file_path, 'Processing...');
    show_linter_state(); // Visual feedback
    var delim = dialect_map[language_id][0];
    var policy = dialect_map[language_id][1];
    var max_check_size = autolint ? 50000 : null;
    var lint_report = produce_lint_report(active_doc, delim, policy, max_check_size);
    lint_results.set(file_path, lint_report);
    return true;
}


function show_linter_state() {
    if (sb_item)
        sb_item.hide();
    active_doc = get_active_doc();
    if (!active_doc)
        return;
    var language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    var file_path = active_doc.fileName;
    if (!lint_results.has(file_path))
        return;
    var lint_report = lint_results.get(file_path);
    if (!sb_item)
        sb_item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    sb_item.text = 'CSVLint';
    if (lint_report === 'OK') {
        sb_item.color = '#62f442';
    } else if (lint_report.indexOf('File is too big') != -1 || lint_report == 'Processing...') {
        sb_item.color = '#ffff28';
    } else {
        sb_item.color = '#f44242';
    }
    sb_item.tooltip = lint_report + '\nClick to recheck';
    sb_item.command = 'extension.CSVLint';
    sb_item.show();
}


function handle_editor_change(editor) {
    csv_lint(true, null);
    show_linter_state();
}


function make_html_table(records) {
    result = [];
    //result.push('<table border="1">');
    // TODO use th elements for header row
    result.push('<table>');
    for (var nr = 0; nr < records.length; nr++) {
        result.push('<tr>');
        for (var nf = 0; nf < records[nr].length; nf++) {
            result.push('<td>');
            result.push(rainbow_utils.escape_html(records[nr][nf]));
            result.push('</td>');
        }
        result.push('</tr>');
    }
    result.push('</table>');
    return result.join('');
}


class RBQLProvider {
    constructor(context) {
        this.onDidChangeEvent = new vscode.EventEmitter();
    }

    provideTextDocumentContent(uri, token) {
        var origin_doc = rbql_origin.document;
        var origin_line = rbql_origin.line;
        var language_id = origin_doc.languageId;
        if (!dialect_map.hasOwnProperty(language_id))
            return;
        var delim = dialect_map[language_id][0];
        var policy = dialect_map[language_id][1];
        var window_records = sample_preview_records(origin_doc, origin_line, 16, delim, policy);
        var html_header = '<!DOCTYPE html><html><head><style> html * { font-size: 16px !important; } table { display: block; overflow-x: auto; white-space: nowrap; border-collapse: collapse; } th, td { border: 1px solid rgb(130, 6, 219); padding: 3px 8px; } input { margin: 10px; } </style></head><body>';
        var html_footer = '</body></html>';
        var html_table = '<h3>Table preview around cursor:</h3>'
        html_table += make_html_table(window_records);
        var input_html = '<br><br><input type="text" id="rbql_input"><button id="rbql_run_btn">Execute</button>'
        return html_header + html_table + input_html + html_footer;
    }

    get onDidChange() {
        return this.onDidChangeEvent.event;
    }

    update(uri) {
        this.onDidChangeEvent.fire(uri);
    }
}

function activate(context) {

    oc_log = vscode.window.createOutputChannel("rainbow_csv_oc");
    oc_log.show();
    oc_log.appendLine('Activating "rainbow_csv"');

    rbql_provider = new RBQLProvider(context);

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

    var lint_cmd = vscode.commands.registerCommand('extension.CSVLint', csv_lint_cmd);
    var rbql_cmd = vscode.commands.registerCommand('extension.RBQL', edit_rbql);

    var switch_event = vscode.window.onDidChangeActiveTextEditor(handle_editor_change)

    var preview_subscription = vscode.workspace.registerTextDocumentContentProvider('rbql', rbql_provider);

    context.subscriptions.push(csv_provider);
    context.subscriptions.push(tsv_provider);
    context.subscriptions.push(scsv_provider);
    context.subscriptions.push(lint_cmd);
    context.subscriptions.push(rbql_cmd);
    context.subscriptions.push(switch_event);
    context.subscriptions.push(preview_subscription);
}


exports.activate = activate;

function deactivate() {
    // This method is called when extension is deactivated
}

exports.deactivate = deactivate;
