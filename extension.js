const vscode = require('vscode');

var rainbow_utils = require('./rainbow_utils');


function guess_document_header(document, split_func) {
    var sampled_records = [];
    var num_lines = document.lineCount;
    var head_count = 10;
    if (num_lines <= head_count * 2) {
        for (var i = 1; i < num_lines; i++) {
            sampled_records.push(split_func(document.lineAt(i).text));
        }
    } else {
        for (var i = 1; i < head_count; i++) {
            sampled_records.push(split_func(document.lineAt(i).text));
        }
        for (var i = num_lines - head_count; i < num_lines; i++) {
            sampled_records.push(split_func(document.lineAt(i).text));
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
    var potential_header = split_func(document.lineAt(0).text);
    var has_header = rainbow_utils.guess_if_header(potential_header, sampled_records);
    return has_header ? potential_header : null;
}


function make_hover_text(document, position, split_func, delim) {
    var lnum = position.line;
    var cnum = position.character;
    var line = document.lineAt(lnum).text;
    var report = split_func(line, delim, cnum);
    var col_num = report[2];
    var entries = report[0];
    var result = 'col# ' + (col_num + 1);
    split_func_simple = function(text) {
        return split_func(text, delim, 0)[0];
    }
    var header = guess_document_header(document, split_func_simple);
    if (header !== null && header.length == entries.length) {
        var column_name = header[col_num];
        result += ', "' + column_name + '"';
    }
    return result;
}


function activate(context) {

    //oc_log = null;
    //oc_log = vscode.window.createOutputChannel("rainbow_csv_oc");
    //oc_log.show();
    //oc_log.appendLine('Activating "rainbow_csv"');

    console.log('Activating "rainbow_csv"');

    csv_provider = vscode.languages.registerHoverProvider('csv', {
        provideHover(document, position, token) {
            hover_text = make_hover_text(document, position, rainbow_utils.split_quoted_str, ',');
            return new vscode.Hover(hover_text);
        }
    });

    tsv_provider = vscode.languages.registerHoverProvider('tsv', {
        provideHover(document, position, token) {
            hover_text = make_hover_text(document, position, rainbow_utils.split_simple_str, '\t');
            return new vscode.Hover(hover_text);
        }
    });

    scsv_provider = vscode.languages.registerHoverProvider('csv (semicolon)', {
        provideHover(document, position, token) {
            hover_text = make_hover_text(document, position, rainbow_utils.split_quoted_str, ';');
            return new vscode.Hover(hover_text);
        }
    });

    context.subscriptions.push(csv_provider);
    context.subscriptions.push(tsv_provider);
    context.subscriptions.push(scsv_provider);
}

exports.activate = activate;

function deactivate() {
    // this method is called when extension is deactivated
}

exports.deactivate = deactivate;
