var rbql_running = false;

var handshake_completed = false;

var query_history = [];

const vscode = acquireVsCodeApi();

const normal_table_border = '1px solid rgb(130, 6, 219)';
const header_table_border = '1px solid red';

var last_preview_message = null;

var active_suggest_idx = null;
var suggest_list = [];

var adjust_join_table_header_callback = null;


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


function get_max_num_columns(records) {
    let max_num_columns = 0;
    for (let r = 0; r < records.length; r++) {
        max_num_columns = Math.max(max_num_columns, records[r].length);
    }
    return max_num_columns;
}


function make_header_index_row(num_columns) {
    let result = [];
    result.push('NR');
    for (let i = 0; i < num_columns; i++) {
        result.push(`a${i + 1}`);
    }
    return result;
}


function add_header_row(max_num_columns, table) {
    let header_index_row = make_header_index_row(max_num_columns);
    let row_elem = document.createElement('tr');
    for (let value of header_index_row) {
        let cell = document.createElement('td');
        cell.style.border = header_table_border;
        cell.style.color = '#FF6868';
        cell.style.fontWeight = 'bold';
        cell.textContent = value;
        row_elem.appendChild(cell);
    }
    table.appendChild(row_elem);
}


function make_data_cell(cell_text, border_style) {
    let cell = document.createElement('td');
    cell.style.border = border_style;
    const trim_marker = '###UI_STRING_TRIM_MARKER###';
    let add_ellipsis = false;
    if (cell_text.endsWith(trim_marker)) {
        cell_text = cell_text.substr(0, cell_text.length - trim_marker.length);
        add_ellipsis = true;
    }
    let field_rfc_lines = cell_text.split('\n');
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
    return cell;
}


function make_nr_cell(cell_text) {
    let nr_cell = document.createElement('td');
    nr_cell.style.border = header_table_border;
    nr_cell.textContent = cell_text;
    return nr_cell;
}


function make_preview_table() {
    if (!last_preview_message)
        return;
    let records = last_preview_message.preview_records;
    let start_record_zero_based = last_preview_message.start_record_zero_based;
    let preview_error = last_preview_message.preview_sampling_error;

    var table = document.getElementById('preview_table');
    remove_children(table);
    if (preview_error) {
        let row = document.createElement('tr');
        table.appendChild(row);
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

    let skip_headers = document.getElementById('skip_headers').checked;
    let max_num_columns = get_max_num_columns(records);
    add_header_row(max_num_columns, table);
    for (var r = 0; r < records.length; r++) {
        let row = document.createElement('tr');
        let NR = r + start_record_zero_based + 1;
        if (skip_headers)
            NR -= 1;
        let nr_text = NR > 0 ? String(NR) : '';
        row.appendChild(make_nr_cell(nr_text));
        for (var nf = 0; nf < records[r].length; nf++) {
            let border_style = NR > 0 ? normal_table_border : header_table_border;
            row.appendChild(make_data_cell(records[r][nf], border_style));
        }
        table.appendChild(row);
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


function process_skip_header_change() {
    let skip_headers = document.getElementById('skip_headers').checked;
    vscode.postMessage({'msg_type': 'skip_headers_change', 'skip_headers': skip_headers}); // We need to send it to remember preview state
    make_preview_table();
}


function show_error(error_type, error_msg) {
    error_msg = error_msg.replace('\r?\n', '\r\n');
    document.getElementById('error_message_header').textContent = 'Error type: "' + error_type + '"';
    document.getElementById('error_message_details').textContent = error_msg;
    document.getElementById('rbql_error_message').style.display = 'block';
    document.getElementById('ack_error').focus();
}


function hide_error_msg() {
    document.getElementById('rbql_error_message').style.display = 'none';
    document.getElementById("rbql_input").focus();
}


function toggle_help_msg() {
    let document_bg_color = window.getComputedStyle(document.body).getPropertyValue("background-color");
    let rbql_help_element = document.getElementById('rbql_help');
    var style_before = rbql_help_element.style.display;
    var new_style = style_before == 'block' ? 'none' : 'block';
    if (new_style == 'block')
        rbql_help_element.style.backgroundColor = document_bg_color;
    rbql_help_element.style.display = new_style;
    document.getElementById('close_help').style.display = new_style;
}


function register_history_callback(button_element, query) {
    button_element.addEventListener("click", () => { document.getElementById('rbql_input').value = query; });
}


function toggle_history() {
    let query_history_block = document.getElementById('query_history');
    var style_before = query_history_block.style.display;
    var new_style = style_before == 'block' ? 'none' : 'block';
    if (new_style == 'block') {
        document.getElementById('toggle_history_btn').textContent = '\u25BC';
    } else {
        document.getElementById('toggle_history_btn').textContent = '\u25B2';
    }
    let history_entries_block = document.getElementById('history_entries');
    remove_children(history_entries_block);
    for (let nr = 0; nr < query_history.length; nr++) {
        let entry_button = document.createElement('button');
        entry_button.className = 'history_button';
        entry_button.textContent = query_history[nr];
        register_history_callback(entry_button, query_history[nr]);
        history_entries_block.appendChild(entry_button);
    }
    query_history_block.style.display = new_style;
    let calculated_height = query_history_block.offsetHeight;
    let text_input_coordinates = document.getElementById('rbql_input').getBoundingClientRect();
    query_history_block.style.left = text_input_coordinates.left + 'px';
    query_history_block.style.top = (text_input_coordinates.top - calculated_height) + 'px';
}


function clear_history() {
    query_history = [];
    toggle_history();
    vscode.postMessage({'msg_type': 'global_param_change', 'key': 'rbql_query_history', 'value': []});
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
    let skip_headers = document.getElementById('skip_headers').checked;
    vscode.postMessage({'msg_type': 'run', 'query': rbql_text, 'backend_language': backend_language, 'output_dialect': output_format, 'encoding': encoding, 'enable_rfc_newlines': enable_rfc_newlines, 'skip_headers': skip_headers});
}


function apply_suggest_callback(query) {
    vscode.postMessage({'msg_type': 'update_query', 'query': query});
}


function fetch_join_header_callback(join_table_id, adjust_join_table_headers) {
    adjust_join_table_header_callback = adjust_join_table_headers;
    let encoding = document.getElementById('select_encoding').value;
    vscode.postMessage({'msg_type': 'fetch_table_header', 'table_id': join_table_id, 'encoding': encoding});
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
        let header = message['header'];
        rbql_suggest.initialize_suggest('rbql_input', 'query_suggest', 'history_button', apply_suggest_callback, header, fetch_join_header_callback);
        let enable_rfc_newlines = message['enable_rfc_newlines'];
        let skip_headers = message['skip_headers'];
        last_preview_message = message;
        document.getElementById("select_backend_language").value = message['backend_language'];
        document.getElementById("select_encoding").value = message['encoding'];
        document.getElementById("enable_rfc_newlines").checked = enable_rfc_newlines;
        document.getElementById("skip_headers").checked = skip_headers;
        if (message['policy'] == 'quoted') {
            document.getElementById('enable_rfc_newlines_section').style.display = 'block';
        }
        make_preview_table();
    }

    if (message_type == 'fetch_table_header_response') {
        if (adjust_join_table_header_callback && message['header']) {
            adjust_join_table_header_callback(message['header']);
        }
    }

    if (message_type == 'navigate' || message_type == 'resample') {
        last_preview_message = message;
        make_preview_table();
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


function is_printable_key_code(keycode) {
    // Taken from here: https://stackoverflow.com/a/12467610/2898283
    return (keycode > 47 && keycode < 58) || keycode == 32 || (keycode > 64 && keycode < 91) || (keycode > 185 && keycode < 193) || (keycode > 218 && keycode < 223);
}


function handle_input_keyup(event) {
    rbql_suggest.handle_input_keyup(event);
    if (is_printable_key_code(event.keyCode) || event.keyCode == 8 /* Bakspace */) {
        let current_query = document.getElementById('rbql_input').value;
        vscode.postMessage({'msg_type': 'update_query', 'query': current_query});
    }
}


function handle_input_keydown(event) {
    if (event.keyCode == 13 && rbql_suggest.active_suggest_idx === null) {
        start_rbql();
    } else {
        rbql_suggest.handle_input_keydown(event);
    }
}


function main() {
    window.addEventListener('message', handle_message);
    vscode.postMessage({'msg_type': 'handshake'});

    document.getElementById("rbql_run_btn").addEventListener("click", start_rbql);
    document.getElementById("select_backend_language").addEventListener("change", report_backend_language_change);
    document.getElementById("select_encoding").addEventListener("change", report_encoding_change);
    document.getElementById("enable_rfc_newlines").addEventListener("click", report_rfc_fields_policy_change);
    document.getElementById("skip_headers").addEventListener("click", process_skip_header_change);
    document.getElementById("ack_error").addEventListener("click", hide_error_msg);
    document.getElementById("help_btn").addEventListener("click", toggle_help_msg);
    document.getElementById("close_help").addEventListener("click", toggle_help_msg);
    document.getElementById("toggle_history_btn").addEventListener("click", toggle_history);
    document.getElementById("clear_history_btn").addEventListener("click", clear_history);
    document.getElementById("go_begin").addEventListener("click", preview_begin);
    document.getElementById("go_up").addEventListener("click", preview_up);
    document.getElementById("go_down").addEventListener("click", preview_down);
    document.getElementById("go_end").addEventListener("click", preview_end);
    document.getElementById("rbql_input").addEventListener("keyup", handle_input_keyup);
    document.getElementById("rbql_input").addEventListener("keydown", handle_input_keydown);
    document.getElementById("rbql_input").focus();
}


document.addEventListener("DOMContentLoaded", function(_event) {
    main();
});
