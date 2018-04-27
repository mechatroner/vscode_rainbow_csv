// FIXME test situation when user switches back and forth between preview and origin file during query editing.

// FIXME close the preview window from main process when query has succeed. We need this because otherwise user would be able to manually switch back to tab and enter another query.

var rbql_running = false;
var handshake_completed = false;

function run_handshake(num_attempts) {
    if (num_attempts <= 0 || handshake_completed) {
        return;
    }
    var rainbow_csv_server = "http://localhost:__EMBEDDED_JS_PORT__/echo";
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200 && xhr.responseText == 'ECHO') {
            handshake_completed = true;
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
    var rainbow_csv_server = "http://localhost:__EMBEDDED_JS_PORT__/run?";
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
            process_rbql_result(xhr.responseText);
        }
    }
    rainbow_csv_server += 'rbql_query=' + encodeURIComponent(rbql_text);
    xhr.open("GET", rainbow_csv_server);
    xhr.send();
}


function main() {
    run_handshake(3);
    document.getElementById("rbql_run_btn").addEventListener("click", start_rbql);
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
