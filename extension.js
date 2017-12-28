const vscode = require('vscode');


function split_quoted_str(src, dlm, query_position_idx) {
    var query_result = null;
    if (src.indexOf('"') == -1) {
        var fields = src.split(dlm);
        var total_len = 0;
        for (var i = 0; i < fields.length; i++) {
            total_len += fields[i].length + 1;
            if (query_result === null && query_position_idx < total_len) {
                query_result = i;
            }
        }
        if (query_result === null) {
            query_result = fields.length - 1;
        }
        return [fields, false, query_result];
    }
    var result = [];
    var warning = false;
    var cidx = 0;
    while (cidx < src.length) {
        if (src.charAt(cidx) === '"') {
            var uidx = cidx + 1;
            while (true) {
                uidx = src.indexOf('"', uidx);
                if (uidx == -1) {
                    if (query_result === null)
                        query_result = result.length;
                    result.push(src.substring(cidx + 1).replace(/""/g, '"'));
                    return [result, true, query_result];
                } else if (uidx + 1 >= src.length || src.charAt(uidx + 1) == dlm) {
                    if (query_result === null && query_position_idx <= uidx + 1) {
                        query_result = result.length;
                    }
                    result.push(src.substring(cidx + 1, uidx).replace(/""/g, '"'));
                    cidx = uidx + 2;
                    break;
                } else if (src.charAt(uidx + 1) == '"') {
                    uidx += 2; 
                    continue;
                } else {
                    warning = true;
                    uidx += 1;
                    continue;
                }
            }
        } else {
            var uidx = src.indexOf(dlm, cidx);
            if (uidx == -1)
                uidx = src.length;
            var field = src.substring(cidx, uidx);
            if (query_result === null && query_position_idx <= uidx) {
                query_result = result.length;
            }
            if (field.indexOf('"') != -1)
                warning = true;
            result.push(field);
            cidx = uidx + 1;
        }
    }
    if (src.charAt(src.length - 1) == dlm) {
        if (query_result === null) {
            query_result = result.length;
        }
        result.push('');
    }
    return [result, warning, query_result];
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
            var line = document.lineAt(lnum);
            var fields = split_quoted_str(line, ',');
            return new vscode.Hover('I am a hover!');
        }
    });

    tsv_provider = vscode.languages.registerHoverProvider('tsv', {
        provideHover(document, position, token) {
            return new vscode.Hover('I am a hover!');
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
