const vscode = require('vscode');

var rainbow_utils = require('./rainbow_utils');

// FIXME we should also run lint on language change non_csv -> csv

var dialect_map = {'CSV': [',', 'quoted'], 'TSV': ['\t', 'simple'], 'CSV (semicolon)': [';', 'quoted']};

var oc_log = null; // for debug

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
    var hover_text = make_hover_text(document, position, language_id);
    if (hover_text && !cancellation_token.isCancellationRequested) {
        return new vscode.Hover(hover_text);
    } else {
        return null;
    }
}


function csv_lint() {
    //vscode.window.showInformationMessage('CSV Lint!');
    var active_window = vscode.window;
    if (!active_window)
        return;
    var active_editor = active_window.activeTextEditor;
    if (!active_editor)
        return;
    var active_doc = active_editor.document;
    if (!active_doc)
        return;
    var language_id = active_doc.languageId;
    if (!dialect_map.hasOwnProperty(language_id))
        return;
    //TODO do not autolint huge files
    var delim = dialect_map[language_id][0];
    var policy = dialect_map[language_id][1];
    var num_lines = active_doc.lineCount;
    for (var lnum = 0; lnum < num_lines; lnum++) {
        var split_result = rainbow_utils.smart_split(active_doc.lineAt(lnum).text, delim, policy, false);
    }
}


function activate(context) {

    //oc_log = vscode.window.createOutputChannel("rainbow_csv_oc");
    //oc_log.show();
    //oc_log.appendLine('Activating "rainbow_csv"');

    console.log('Activating "rainbow_csv"');

    var csv_provider = vscode.languages.registerHoverProvider('CSV', {
        provideHover(document, position, token) {
            return make_hover(document, position, 'CSV', token);
        }
    });

    var tsv_provider = vscode.languages.registerHoverProvider('TSV', {
        provideHover(document, position, token) {
            return make_hover(document, position, 'TSV', token);
        }
    });

    var scsv_provider = vscode.languages.registerHoverProvider('CSV (semicolon)', {
        provideHover(document, position, token) {
            return make_hover(document, position, 'CSV (semicolon)', token);
        }
    });

    var lint_cmd = vscode.commands.registerCommand('extension.CSVLint', csv_lint);

    context.subscriptions.push(csv_provider);
    context.subscriptions.push(tsv_provider);
    context.subscriptions.push(scsv_provider);
    context.subscriptions.push(lint_cmd);
}

exports.activate = activate;

function deactivate() {
    // this method is called when extension is deactivated
}

exports.deactivate = deactivate;
