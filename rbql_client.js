// FIXME add table naming feature and document it

var rbql_running = false;
var handshake_completed = false;

var security_tokens = ["__TEMPLATE_SECURITY_TOKENS__"];
var token_num = 0;

var host_lang_presentations = [{'key': 'python', 'name': 'Python', 'color': '#3572A5'}, {'key': 'js', 'name': 'JavaScript', 'color': '#F1E05A'}];

const vscode_server = 'http://localhost:__TEMPLATE_JS_PORT__';

var custom_colors = null;

function display_host_language(host_language) {
    var language_info = null;
    for (var i = 0; i < host_lang_presentations.length; i++) {
        if (host_lang_presentations[i]['key'] == host_language) {
            language_info = host_lang_presentations[i];
            break;
        }
    }
    document.getElementById('host_language_change').style.backgroundColor = language_info['color'];
    document.getElementById('host_language_change').textContent = language_info['name'];
}


function get_current_lang_idx() {
    var current_lang_name = document.getElementById('host_language_change').textContent;
    for (var i = 0; i < host_lang_presentations.length; i++) {
        if (host_lang_presentations[i]['name'] == current_lang_name) {
            return i;
        }
    }
    return -1;
}


function switch_host_language() {
    var lang_idx = get_current_lang_idx();
    var next_idx = (lang_idx + 1) % host_lang_presentations.length;
    display_host_language(host_lang_presentations[next_idx]['key']);
}

function remove_children(root_node) {
    while (root_node.firstChild) {
        root_node.removeChild(root_node.firstChild);
    }
}


function make_preview_table(customized_colors, records) {
    var table = document.getElementById('preview_table');
    remove_children(table);
    for (var nr = 0; nr < records.length; nr++) {
        var row = document.createElement('tr');
        table.appendChild(row);
        for (var nf = 0; nf < records[nr].length; nf++) {
            var cell = document.createElement('td');
            if (customized_colors && nf > 0) {
                var foreground = customized_colors[(nf - 1) % 10]['foreground'];
                var font_style = customized_colors[(nf - 1) % 10]['fontStyle'];
                cell.style.color = foreground;
                if (font_style == 'bold') {
                    cell.style.fontWeight = 'bold';
                } else if (font_style == 'italic') {
                    cell.style.fontStyle = 'italic';
                } else if (font_style == 'underline') {
                    cell.style.textDecoration = 'underline';
                }
            }
            if (nf == 0 || nr == 0) {
                cell.style.border = '1px solid red';
            } else {
                cell.style.border = '1px solid rgb(130, 6, 219)';
            }
            cell.textContent = records[nr][nf];
            row.appendChild(cell);
        }
    }
}


function run_handshake(num_attempts) {
    if (num_attempts <= 0 || handshake_completed) {
        return;
    }
    var api_url = vscode_server + "/init";
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
            var init_report = JSON.parse(xhr.responseText);
            handshake_completed = true;
            if (init_report.hasOwnProperty('last_query')) {
                document.getElementById('rbql_input').value = init_report['last_query'];
            }
            custom_colors = init_report['custom_colors'];
            var window_records = init_report['window_records'];
            make_preview_table(custom_colors, window_records);
            if (!custom_colors) {
                document.getElementById("colors_hint").style.display = 'block';
            }
            display_host_language(init_report['host_language']);
            document.getElementById("init_running").style.display = 'none';
            document.getElementById("rbql_dashboard").style.display = 'block';
        }
    }
    xhr.open("GET", api_url);
    xhr.send();
    setTimeout(function() { run_handshake(num_attempts - 1); }, 1000);
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


function navigate_preview(direction) {
    // TODO improve table display logic: make sure that columns width doesn't change.
    var api_url = vscode_server + "/preview?navig_direction=" + direction;
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
            var preview_report = JSON.parse(xhr.responseText);
            var window_records = preview_report['window_records'];
            make_preview_table(custom_colors, window_records);
        }
    }
    xhr.open("GET", api_url);
    xhr.send();
}


function show_error(error_type, error_details) {
    error_details = error_details.replace('\r?\n', '\r\n');
    document.getElementById('error_message_header').textContent = 'Error type: "' + error_type + '"';
    document.getElementById('error_message_details').textContent = error_details;
    document.getElementById('rbql_error_message').style.display = 'block';
}


function process_rbql_result(rbql_result_json) {
    rbql_running = false;
    try {
        report = JSON.parse(rbql_result_json);
    } catch (e) {
        report = {"error_type": "Integration", "error_details": "Server JSON response parsing error"};
    }
    if (report.hasOwnProperty('error_type') || report.hasOwnProperty('error_details')) {
        var error_type = report.hasOwnProperty('error_type') ? report['error_type'] : 'Unknown Error';
        var error_details = report.hasOwnProperty('error_details') ? report['error_details'] : 'Unknown Error';
        show_error(error_type, error_details);
    }
    document.getElementById('status_label').textContent = "";
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

    var rbql_host_lang = document.getElementById('host_language_change')

    var api_url = vscode_server + "/run?";
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
            process_rbql_result(xhr.responseText);
        }
    }
    var host_language = host_lang_presentations[get_current_lang_idx()]['key'];
    if (token_num >= security_tokens.length) {
        return;
    }
    var security_token = security_tokens[token_num];
    token_num += 1;
    api_url += 'rbql_query=' + encodeURIComponent(rbql_text) + '&host_language=' + host_language + '&security_token=' + security_token;
    xhr.open("GET", api_url);
    xhr.send();
}


function main() {
    run_handshake(3);
    document.getElementById("rbql_run_btn").addEventListener("click", start_rbql);
    document.getElementById("host_language_change").addEventListener("click", switch_host_language);
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
