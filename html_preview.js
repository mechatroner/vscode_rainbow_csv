// FIXME prettify, highlight columns in rainbow colors, highlight html table header, add help and examples. Add command history.

function escape_html(src) {
    return String(src).replace(/[&<>"'`=\/]/g, function (s) { return entity_map[s]; });
}


function make_html_table(records) {
    result = [];
    result.push('<table>');
    for (var nr = 0; nr < records.length; nr++) {
        result.push('<tr>');
        for (var nf = 0; nf < records[nr].length; nf++) {
            var tag_name = nr ? 'td' : 'th';
            var color_attr = nf ? '' : ' bgcolor="rgb(130, 6, 219)"'
            var open_tag = '<' + tag_name + color_attr + '>';
            var close_tag = '</' + tag_name + '>';
            result.push(open_tag);
            result.push(escape_html(records[nr][nf]));
            result.push(close_tag);
        }
        result.push('</tr>');
    }
    result.push('</table>');
    return result.join('');
}


function slow_replace_all(src, old_substr, new_substr) {
    while (src.indexOf(old_substr) != -1) {
        src = src.replace(old_substr, new_substr);
    }
    return src;
}


function make_preview(client_html_template, client_js_template, preview_records, origin_server_port) {
    var client_side_js = slow_replace_all(client_js_template, '__EMBEDDED_JS_PORT__', String(origin_server_port));
    var html_table = make_html_table(preview_records);
    client_html_template = slow_replace_all(client_html_template, '__EMBEDDED_JS_PORT__', String(origin_server_port));
    client_html_template = slow_replace_all(client_html_template, '//__TEMPLATE_JS_CLIENT__', client_side_js);
    // TODO instead of replacing __TEMPLATE_HTML_TABLE__ pass table rows through extension server to get rid of this hack.
    var client_side_html = slow_replace_all(client_html_template, '<!--__TEMPLATE_HTML_TABLE__-->', html_table);
    return client_side_html;
}


module.exports.make_preview = make_preview;
