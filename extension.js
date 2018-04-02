const vscode = require('vscode');

var rainbow_utils = require('./rainbow_utils');

var dialect_map = {'csv': [',', 'quoted'], 'tsv': ['\t', 'simple'], 'csv (semicolon)': [';', 'quoted']};

var oc_log = null; // For debug

var lint_results = new Map();
var sb_item = null;

var rbql_provider = null;

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
    var active_doc = get_active_doc();
    if (!active_doc)
        return;
    var orig_uri = active_doc.uri;
    if (!orig_uri)
        return;
    var rbql_uri = orig_uri.with({
        scheme: 'rbql'
    });
    //rbql_uri = vscode.Uri.parse('rbql://authority/fixme'); //FIXME
	rbql_uri = vscode.Uri.parse('rbql://authority/rbql-preview');
    oc_log.appendLine('orig uri: ' + JSON.stringify(orig_uri));
    oc_log.appendLine('editing content for ' + JSON.stringify(rbql_uri));
    //let success = await vscode.commands.executeCommand('vscode.previewHtml', rbql_uri);
    //
    vscode.commands.executeCommand('vscode.previewHtml', rbql_uri).then(handle_preview_success, handle_preview_error);
    //rbql_provider.update(rbql_uri);
    oc_log.appendLine('after preview html');
    //vscode.workspace.openTextDocument(rbql_uri);
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

function create_preview(doc) {
    oc_log.appendLine('creating preview for ' + doc.uri);
}


class RBQLProvider {
    constructor(context) {
        oc_log.appendLine('in RBQLProvider constructor');
        this.onDidChangeEvent = new vscode.EventEmitter();
    }

    provideTextDocumentContent(uri, token) {
        let file_uri = uri.with({
            scheme: "file"
        });

        oc_log.appendLine('Opening uri ' + JSON.stringify(file_uri));
        // FIXME open text document here
        //return workspace.openTextDocument(file).then(doc => {
        //return vscode.workspace.openTextDocument(file_uri).then(create_preview);

        //oc_log.appendLine('Providing content for ' + uri);
        return '<!DOCTYPE html><html><head></head><body><div id="rbql">Hello RBQL!</div></body></html>';
        //return 'Hello RBQL!';
    }

    get onDidChange() {
        return this.onDidChangeEvent.event;
    }

    update(uri) {
        oc_log.appendLine('Updating uri: ' + JSON.stringify(uri));
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
