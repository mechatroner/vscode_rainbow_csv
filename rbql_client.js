// FIXME test situation when user switches back and forth between preview and origin file during query editing.

// FIXME close the preview window from main process when query has succeed. We need this because otherwise user would be able to manually switch back to tab and enter another query.

// FIXME pass all params using server mechanism

var rbql_running = false;
var handshake_completed = false;

var host_lang_presentations = [{'key': 'python', 'name': 'Python', 'color': '#3572A5'}, {'key': 'js', 'name': 'JavaScript', 'color': '#F1E05A'}];


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


function run_handshake(num_attempts) {
    if (num_attempts <= 0 || handshake_completed) {
        return;
    }
    var rainbow_csv_server = "http://localhost:__EMBEDDED_JS_PORT__/init";
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
            init_report = JSON.parse(xhr.responseText);
            if (!init_report.hasOwnProperty('RBQL')) {
                return;
            }
            handshake_completed = true;
            if (init_report.hasOwnProperty('last_query')) {
                document.getElementById('rbql_input').value = init_report['last_query'];
            }
            display_host_language(init_report['host_language']);
            // FIXME change language on click
            document.getElementById("init_running").style.display = 'none';
            document.getElementById("rbql_dashboard").style.display = 'block';
        }
    }
    xhr.open("GET", rainbow_csv_server);
    xhr.send();
    setTimeout(function() { run_handshake(num_attempts - 1); }, 1000);
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


function start_rbql() {
    if (rbql_running) {
        return;
    }
    rbql_running = true;
    document.getElementById('status_label').textContent = "Running...";

    var rbql_text = document.getElementById('rbql_input').value;
    var rbql_host_lang = document.getElementById('host_language_change')
    var rainbow_csv_server = "http://localhost:__EMBEDDED_JS_PORT__/run?";
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
            process_rbql_result(xhr.responseText);
        }
    }
    var host_language = host_lang_presentations[get_current_lang_idx()]['key'];
    rainbow_csv_server += 'rbql_query=' + encodeURIComponent(rbql_text) + '&host_language=' + host_language;
    xhr.open("GET", rainbow_csv_server);
    xhr.send();
}


function main() {
    run_handshake(3);
    document.getElementById("rbql_run_btn").addEventListener("click", start_rbql);
    document.getElementById("host_language_change").addEventListener("click", switch_host_language);
    document.getElementById("ack_error").addEventListener("click", hide_error_msg);
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
