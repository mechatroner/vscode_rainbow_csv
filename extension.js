const vscode = require('vscode');

rainbow_utils = require('rainbow_utils')


function guess_document_header(document, delim) {
    var sampled_records = [];
    var num_lines = document.lineCount;
    var head_count = 10;
    if (num_lines <= head_count * 2) {
        for (var i = 1; i < num_lines; i++) {
            sampled_records.push(rainbow_utils.split_simple_str(document.lineAt(i).text, delim, 0)[0]);
        }
    } else {
        for (var i = 1; i < head_count; i++) {
            sampled_records.push(rainbow_utils.split_simple_str(document.lineAt(i).text, delim, 0)[0]);
        }
        for (var i = num_lines - head_count; i < num_lines; i++) {
            sampled_records.push(rainbow_utils.split_simple_str(document.lineAt(i).text, delim, 0)[0]);
        }
    }
    if (sampled_records.length < 10)
        return null;
    var potential_header = rainbow_utils.split_simple_str(document.lineAt(0).text, delim, 0)[0];
    var has_header = rainbow_utils.guess_if_header(potential_header, sampled_records);
    return has_header ? potential_header : null;
}


function activate(context) {

    //oc_log = vscode.window.createOutputChannel("rainbow_csv_oc");
    //oc_log.show();
    //oc_log.appendLine('Activating "rainbow_csv"');

    console.log('Activating "rainbow_csv"');

    csv_provider = vscode.languages.registerHoverProvider('csv', {
        provideHover(document, position, token) {
            var lnum = position.line;
            var cnum = position.character;
            var line = document.lineAt(lnum).text;
            var fields = rainbow_utils.split_quoted_str(line, ',', cnum);
            var col_num = fields[2];
            return new vscode.Hover('col# ' + (col_num + 1));
        }
    });

    tsv_provider = vscode.languages.registerHoverProvider('tsv', {
        provideHover(document, position, token) {
            var lnum = position.line;
            var cnum = position.character;
            var line = document.lineAt(lnum).text;
            var fields = rainbow_utils.split_simple_str(line, '\t', cnum);
            var col_num = fields[2];
            return new vscode.Hover('col# ' + (col_num + 1));
        }
    });

    context.subscriptions.push(csv_provider);
    context.subscriptions.push(tsv_provider);
}

exports.activate = activate;

function deactivate() {
    // this method is called when extension is deactivated
}

exports.deactivate = deactivate;
