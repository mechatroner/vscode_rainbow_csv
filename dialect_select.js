const vscode = acquireVsCodeApi();

function handle_manual_separator_change() {
    document.getElementById("separator_selector").value = document.getElementById("manual_entry_option").value;
}


function handle_message(msg_event) {
    console.log('message received at client: ' + JSON.stringify(msg_event));
    var message = msg_event.data;
    if (!message) {
        return;
    }
    let message_type = message['msg_type'];
    if (message_type == 'dialect_handshake') {
        let selected_separator = message.selected_separator;
        if (selected_separator == '\t') {
            document.getElementById("separator_selector").value = document.getElementById("tab_option").value;
        } else if (selected_separator == ' ') {
            document.getElementById("separator_selector").value = document.getElementById("whitespace_option").value;
        } else if (selected_separator) {
            document.getElementById("custom_separator_input").value = selected_separator;
            document.getElementById("separator_selector").value = document.getElementById("manual_entry_option").value;
        }
    }
}


function handle_apply_click() {
    let separator_selection_option = document.getElementById("separator_selector").value;
    let manual_separator_text = document.getElementById("custom_separator_input").value;
    if (!manual_separator_text) {
        if (separator_selection_option == 'comma') {
            manual_separator_text = ',';
        } else if (separator_selection_option == 'tab') {
            manual_separator_text = '\t';
        } else if (separator_selection_option == 'whitespace') {
            manual_separator_text = ' ';
        }
    }
    let policy = document.getElementById("select_policy").value;
    let custom_comment_prefix = document.getElementById("custom_comment_prefix").value;
    vscode.postMessage({'msg_type': 'apply_dialect', 'delim': manual_separator_text, 'policy': policy, 'comment_prefix': custom_comment_prefix});
}


function main() {
    window.addEventListener('message', handle_message);
    vscode.postMessage({'msg_type': 'dialect_handshake'});

    document.getElementById("custom_separator_input").addEventListener("input", handle_manual_separator_change);
    document.getElementById("apply_button").addEventListener("click", handle_apply_click);
}

document.addEventListener("DOMContentLoaded", function(_event) {
    main();
});
