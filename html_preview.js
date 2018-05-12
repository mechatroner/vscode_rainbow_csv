// FIXME get rid of this module it has only 2 small functions: move them to extension.js

function slow_replace_all(src, old_substr, new_substr) {
    while (src.indexOf(old_substr) != -1) {
        src = src.replace(old_substr, new_substr);
    }
    return src;
}


function make_preview(client_html_template, client_js_template, origin_server_port) {
    // FIXME find out whether you need to escape `<`, `>` and other chars when embedding js into html
    client_html_template = slow_replace_all(client_html_template, '//__TEMPLATE_JS_CLIENT__', client_js_template);
    client_html_template = slow_replace_all(client_html_template, '__EMBEDDED_JS_PORT__', String(origin_server_port));
    return client_html_template;
}

module.exports.make_preview = make_preview;
