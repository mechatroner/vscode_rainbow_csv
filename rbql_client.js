var rbql_running = false;

var handshake_completed = false;

var query_history = [];

const vscode = acquireVsCodeApi();


function report_backend_language_change() {
    let backend_language = document.getElementById('select_backend_language').value;
    vscode.postMessage({'msg_type': 'global_param_change', 'key': 'rbql_backend_language', 'value': backend_language});
}


function report_encoding_change() {
    let encoding = document.getElementById('select_encoding').value;
    vscode.postMessage({'msg_type': 'global_param_change', 'key': 'rbql_encoding', 'value': encoding});
}


function report_rfc_fields_policy_change() {
    let enable_rfc_newlines = document.getElementById('enable_rfc_newlines').checked;
    vscode.postMessage({'msg_type': 'newlines_policy_change', 'enable_rfc_newlines': enable_rfc_newlines});
}


function remove_children(root_node) {
    while (root_node.firstChild) {
        root_node.removeChild(root_node.firstChild);
    }
}


function make_preview_table(records, preview_error) {
    var table = document.getElementById('preview_table');
    remove_children(table);
    if (preview_error) {
        let row = document.createElement('tr');
        table.appendChild(row);
        let cell = document.createElement('td');
        let span = document.createElement('span');
        span.style.color = '#FF6868';
        span.textContent = 'Unable to display preview table and run RBQL query:';
        row.appendChild(span);
        row.appendChild(document.createElement('br'));
        span = document.createElement('span');
        span.style.color = '#FF6868';
        span.textContent = preview_error;
        row.appendChild(span);
        return;
    }
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
            let field_value = records[nr][nf];
            const trim_marker = '###UI_STRING_TRIM_MARKER###';
            let add_ellipsis = false;
            if (field_value.endsWith(trim_marker)) {
                field_value = field_value.substr(0, field_value.length - trim_marker.length);
                add_ellipsis = true;
            }
            let field_rfc_lines = field_value.split('\n');
            for (let i = 0; i < field_rfc_lines.length; i++) {
                let span = document.createElement('span');
                span.textContent = field_rfc_lines[i];
                cell.appendChild(span);
                if (i + 1 < field_rfc_lines.length) {
                    let newline_span = document.createElement('span');
                    newline_span.textContent = '\\n';
                    newline_span.style.color = 'yellow';
                    newline_span.title = 'new line';
                    cell.appendChild(newline_span);
                }
            }
            if (add_ellipsis) {
                let ellipsis_span = document.createElement('span');
                ellipsis_span.style.color = 'yellow';
                ellipsis_span.textContent = ' ...';
                ellipsis_span.title = 'value too long to display';
                cell.appendChild(ellipsis_span);
            }
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


function show_error(error_type, error_msg) {
    error_msg = error_msg.replace('\r?\n', '\r\n');
    document.getElementById('error_message_header').textContent = 'Error type: "' + error_type + '"';
    document.getElementById('error_message_details').textContent = error_msg;
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


function get_coordinates(elem) {
    // Taken from here: https://javascript.info/coordinates
    let box = elem.getBoundingClientRect();
    return {top: box.top + window.pageYOffset, left: box.left + window.pageXOffset};
}


function register_history_callback(button_element, query) {
    button_element.addEventListener("click", () => { document.getElementById('rbql_input').value = query; });
}


function toggle_history() {
    var style_before = document.getElementById('query_history').style.display;
    var new_style = style_before == 'block' ? 'none' : 'block';
    if (new_style == 'block') {
        document.getElementById('toggle_history_btn').textContent = '\u25BC';
    } else {
        document.getElementById('toggle_history_btn').textContent = '\u25B2';
    }
    let text_input_coordinates = get_coordinates(document.getElementById('rbql_input'));
    let history_entries_block = document.getElementById('history_entries');
    remove_children(history_entries_block);
    for (let nr = 0; nr < query_history.length; nr++) {
        let entry_button = document.createElement('button');
        entry_button.className = 'history_button';
        entry_button.textContent = query_history[nr];
        register_history_callback(entry_button, query_history[nr]);
        history_entries_block.appendChild(entry_button);
    }
    let query_history_block = document.getElementById('query_history');
    query_history_block.style.display = new_style;
    let calculated_history_height = query_history_block.scrollHeight;
    query_history_block.style.left = text_input_coordinates.left + 'px';
    query_history_block.style.top = text_input_coordinates.top - calculated_history_height + 'px';
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
    let enable_rfc_newlines = document.getElementById('enable_rfc_newlines').checked;
    vscode.postMessage({'msg_type': 'run', 'query': rbql_text, 'backend_language': backend_language, 'output_dialect': output_format, 'encoding': encoding, 'enable_rfc_newlines': enable_rfc_newlines});
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
        if (message.hasOwnProperty('query_history')) {
            query_history = message['query_history'];
        }
        let enable_rfc_newlines = message['enable_rfc_newlines'];
        make_preview_table(message['preview_records'], message['preview_sampling_error']);
        document.getElementById("select_backend_language").value = message['backend_language'];
        document.getElementById("select_encoding").value = message['encoding'];
        document.getElementById("enable_rfc_newlines").checked = enable_rfc_newlines;
        if (message['policy'] == 'quoted') {
            document.getElementById('enable_rfc_newlines_section').style.display = 'block';
        }
    }

    if (message_type == 'navigate' || message_type == 'resample') {
        make_preview_table(message['preview_records'], message['preview_sampling_error']);
    }

    if (message_type == 'rbql_report') {
        rbql_running = false;
        if (message.hasOwnProperty('error_type') || message.hasOwnProperty('error_msg')) {
            let error_type = message.hasOwnProperty('error_type') ? message['error_type'] : 'Unexpected';
            let error_msg = message.hasOwnProperty('error_msg') ? message['error_msg'] : 'Unknown Error';
            show_error(error_type, error_msg);
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
    document.getElementById("enable_rfc_newlines").addEventListener("click", report_rfc_fields_policy_change);
    document.getElementById("ack_error").addEventListener("click", hide_error_msg);
    document.getElementById("help_btn").addEventListener("click", toggle_help_msg);
    document.getElementById("toggle_history_btn").addEventListener("click", toggle_history);
    document.getElementById("go_begin").addEventListener("click", preview_begin);
    document.getElementById("go_up").addEventListener("click", preview_up);
    document.getElementById("go_down").addEventListener("click", preview_down);
    document.getElementById("go_end").addEventListener("click", preview_end);
    document.getElementById("rbql_input").focus();
    document.getElementById("rbql_input").addEventListener("keyup", function(event) {
        event.preventDefault();
        if (event.keyCode == 13) {
            start_rbql();
        } else {
            let current_query = document.getElementById('rbql_input').value;
            vscode.postMessage({'msg_type': 'update_query', 'query': current_query});
        }
    });
}


document.addEventListener("DOMContentLoaded", function(_event) {
    main();
});
