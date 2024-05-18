const vscode = acquireVsCodeApi();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function handle_manual_separator_change() {
    document.getElementById("separator_selector").value = document.getElementById("manual_entry_option").value;
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
    let policy = document.getElementById("policy_selector").value;
    let custom_comment_prefix = document.getElementById("custom_comment_prefix").value;
    vscode.postMessage({'msg_type': 'apply_dialect', 'delim': manual_separator_text, 'policy': policy, 'comment_prefix': custom_comment_prefix});
}


async function handle_message(msg_event) {
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

        let policy = document.getElementById("simple_option").value;
        if (selected_separator == ' ') {
            policy = document.getElementById("merging_option").value;
        } else if (selected_separator == ',' || selected_separator == ';' || !selected_separator) {
            policy = document.getElementById("rfc_option").value;
        }
        document.getElementById("policy_selector").value = policy;

        if (message.integration_test) {
            await sleep(1500);
            handle_apply_click();
        }
    }
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
