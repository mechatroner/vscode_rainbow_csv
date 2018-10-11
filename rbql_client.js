// TODO add table naming feature and document it

var rbql_running = false;

var backend_lang_presentations = [{'key': 'python', 'name': 'Python', 'color': '#3572A5'}, {'key': 'js', 'name': 'JavaScript', 'color': '#F1E05A'}];

var handshake_completed = false;

const vscode = acquireVsCodeApi();


function display_backend_language(backend_language) {
    var language_info = null;
    for (var i = 0; i < backend_lang_presentations.length; i++) {
        if (backend_lang_presentations[i]['key'] == backend_language) {
            language_info = backend_lang_presentations[i];
            break;
        }
    }
    if (backend_language == 'python') {
        document.getElementById('python_warning').textContent = ' (Requires python installed and added to PATH) ';
    } else {
        document.getElementById('python_warning').textContent = '';
    }
    document.getElementById('backend_language_change').style.backgroundColor = language_info['color'];
    document.getElementById('backend_language_change').textContent = language_info['name'];
}


function get_current_lang_idx() {
    var current_lang_name = document.getElementById('backend_language_change').textContent;
    for (var i = 0; i < backend_lang_presentations.length; i++) {
        if (backend_lang_presentations[i]['name'] == current_lang_name) {
            return i;
        }
    }
    return -1;
}


function switch_backend_language() {
    var lang_idx = get_current_lang_idx();
    var next_idx = (lang_idx + 1) % backend_lang_presentations.length;
    let backend_language = backend_lang_presentations[next_idx]['key'];
    vscode.postMessage({'msg_type': 'backend_language_change', 'backend_language': backend_language});
    display_backend_language(backend_language);
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
    let backend_language = backend_lang_presentations[get_current_lang_idx()]['key'];
    vscode.postMessage({'msg_type': 'run', 'query': rbql_text, 'backend_language': backend_language});
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
        display_backend_language(message['backend_language']);
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
    document.getElementById("backend_language_change").addEventListener("click", switch_backend_language);
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
