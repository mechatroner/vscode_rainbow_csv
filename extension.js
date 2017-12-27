const vscode = require('vscode');

function activate(context) {

    oc_log = vscode.window.createOutputChannel("rainbow_csv_oc");
    oc_log.show();
    oc_log.appendLine('Activating "rainbow_csv"');

    console.log('Activating "rainbow_csv"');

    csv_provider = vscode.languages.registerHoverProvider('csv', {
        provideHover(document, position, token) {
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

    let disposable = vscode.commands.registerCommand('extension.sayHello', function () {
        oc_log.appendLine('hello world!');
        vscode.window.showInformationMessage('Hello World and rainbow_csv!');
    });
    context.subscriptions.push(disposable);

}

exports.activate = activate;

function deactivate() {
    // this method is called when extension is deactivated
}

exports.deactivate = deactivate;
