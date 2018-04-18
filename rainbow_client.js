// This module contains client-side template js code

var js_template = `

// FIXME test situation when user switches back and forth between preview and origin file during query editing.

// FIXME close the preview window from main process when query has succeed. We need this because otherwise user would be able to manually switch back to tab and enter another query.


function run_handshake() {
    var rainbow_csv_server = "http://localhost:__EMBEDDED_JS_PORT__/echo";
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200 && xhr.responseText == 'ECHO') {
            document.getElementById("init_running").style.display = 'none';
            document.getElementById("rbql_dashboard").style.display = 'block';
        }
    }
    xhr.open("GET", rainbow_csv_server);
    xhr.send();
}


function start_rbql() {
    var rbql_text = document.getElementById('rbql_input').value;
    var rainbow_csv_server = "http://localhost:__EMBEDDED_JS_PORT__/run?";
    var xhr = new XMLHttpRequest();
    rainbow_csv_server += 'rbql_query=' + encodeURIComponent(rbql_text);
    xhr.open("GET", rainbow_csv_server);
    // FIXME immediately show "Running" state. It can be replaced with error: If something is wrong with the rbql query.
    // So the server responds either with query complete or query has error -> in this case error will be shown and user can adjust it.
    xhr.send();
}


function main() {
    run_handshake();
    document.getElementById("rbql_run_btn").addEventListener("click", start_rbql);
}


document.addEventListener("DOMContentLoaded", function(event) {
    main();
});

`

module.exports.js_template = js_template;
