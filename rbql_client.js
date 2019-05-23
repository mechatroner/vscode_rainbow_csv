// TODO add table naming feature and document it

var rbql_running = false;

var handshake_completed = false;

const vscode = acquireVsCodeApi();


function report_backend_language_change() {
    let backend_language = document.getElementById('select_backend_language').value;
    vscode.postMessage({'msg_type': 'global_param_change', 'key': 'rbql_backend_language', 'value': backend_language});
}


function report_encoding_change() {
    let encoding = document.getElementById('select_encoding').value;
    vscode.postMessage({'msg_type': 'global_param_change', 'key': 'rbql_encoding', 'value': encoding});
}


function remove_children(root_node) {
    while (root_node.firstChild) {
        root_node.removeChild(root_node.firstChild);
    }
}


function make_preview_table(records) {
    var table = document.getElementById('preview_table');
    remove_children(table);
    for (var nr = 0; nr < records.length; nr++) {
        var row = document.createElement('tr');
        table.appendChild(row);
        for (var nf = 0; nf < records[nr].length; nf++) {
            var cell = document.createElement('td');
            if (nf == 0 || nr == 0) {
                cell.style.border = '1px solid red';
            } else {
                cell.style.border = '1px solid rgb(130, 6, 219)';
            }
            if (nr == 0) {
                cell.style.color = '#FF6868';
                cell.style.fontWeight = 'bold';
            }
            cell.textContent = records[nr][nf];
            row.appendChild(cell);
        }
    }
}


function navigate_preview(direction) {
    vscode.postMessage({'msg_type': 'navigate', 'direction': direction});
}


function preview_up() {
    navigate_preview('up');
}


function preview_down() {
    navigate_preview('down');
}


function preview_begin() {
    navigate_preview('begin');
}


function preview_end() {
    navigate_preview('end');
}


function show_error(error_type, error_details) {
    error_details = error_details.replace('\r?\n', '\r\n');
    document.getElementById('error_message_header').textContent = 'Error type: "' + error_type + '"';
    document.getElementById('error_message_details').textContent = error_details;
    document.getElementById('rbql_error_message').style.display = 'block';
}


function hide_error_msg() {
    document.getElementById('rbql_error_message').style.display = 'none';
}


function toggle_help_msg() {
    var style_before = document.getElementById('rbql_help').style.display;
    var new_style = style_before == 'block' ? 'none' : 'block';
    document.getElementById('rbql_help').style.display = new_style;
}


function start_rbql() {
    var rbql_text = document.getElementById('rbql_input').value;
    if (!rbql_text || rbql_running)
        return;
    rbql_running = true;
    document.getElementById('status_label').textContent = "Running...";
    let backend_language = document.getElementById('select_backend_language').value;
    let output_format = document.getElementById('select_output_format').value;
    let encoding = document.getElementById('select_encoding').value;
    vscode.postMessage({'msg_type': 'run', 'query': rbql_text, 'backend_language': backend_language, 'output_dialect': output_format, 'encoding': encoding});
}


function handle_message(msg_event) {
    var message = msg_event.data;
    console.log('message received at client: ' + JSON.stringify(msg_event));
    let message_type = message['msg_type'];

    if (message_type == 'handshake') {
        if (handshake_completed)
            return;
        handshake_completed = true;
        if (message.hasOwnProperty('last_query')) {
            document.getElementById('rbql_input').value = message['last_query'];
        }
        var window_records = message['window_records'];
        make_preview_table(window_records);
        document.getElementById("select_backend_language").value = message['backend_language'];
        document.getElementById("select_encoding").value = message['encoding'];
    }

    if (message_type == 'navigate') {
        let window_records = message['window_records'];
        make_preview_table(window_records);
    }

    if (message_type == 'rbql_report') {
        let report = message['report'];
        rbql_running = false;
        if (report.hasOwnProperty('error_type') || report.hasOwnProperty('error_details')) {
            let error_type = report.hasOwnProperty('error_type') ? report['error_type'] : 'Unknown Error';
            let error_details = report.hasOwnProperty('error_details') ? report['error_details'] : 'Unknown Error';
            show_error(error_type, error_details);
        }
        document.getElementById('status_label').textContent = "";
    }
}


function main() {
    window.addEventListener('message', handle_message);
    vscode.postMessage({'msg_type': 'handshake'});

    document.getElementById("rbql_run_btn").addEventListener("click", start_rbql);
    document.getElementById("select_backend_language").addEventListener("change", report_backend_language_change);
    document.getElementById("select_encoding").addEventListener("change", report_encoding_change);
    document.getElementById("ack_error").addEventListener("click", hide_error_msg);
    document.getElementById("help_btn").addEventListener("click", toggle_help_msg);
    document.getElementById("go_begin").addEventListener("click", preview_begin);
    document.getElementById("go_up").addEventListener("click", preview_up);
    document.getElementById("go_down").addEventListener("click", preview_down);
    document.getElementById("go_end").addEventListener("click", preview_end);
    document.getElementById("rbql_input").focus();
    document.getElementById("rbql_input").addEventListener("keyup", function(event) {
        event.preventDefault();
        if (event.keyCode == 13) {
            start_rbql();
        }
    });
}


document.addEventListener("DOMContentLoaded", function(event) {
    main();
});
