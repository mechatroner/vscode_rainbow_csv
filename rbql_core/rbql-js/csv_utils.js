let field_regular_expression = '"((?:[^"]*"")*[^"]*)"';
let field_rgx = new RegExp('^' + field_regular_expression);
let field_rgx_external_whitespaces = new RegExp('^ *' + field_regular_expression + ' *');


// TODO consider making this file (and rbql.js) both node and browser compatible: https://caolan.org/posts/writing_for_node_and_the_browser.html


function split_lines(text) {
    return text.split(/\r\n|\r|\n/);
}


function extract_next_field(src, dlm, preserve_quotes_and_whitespaces, allow_external_whitespaces, cidx, result) {
    var warning = false;
    let src_cur = src.substring(cidx);
    let rgx = allow_external_whitespaces ? field_rgx_external_whitespaces : field_rgx;
    let match_obj = rgx.exec(src_cur);
    if (match_obj !== null) {
        let match_end = match_obj[0].length;
        if (cidx + match_end == src.length || src[cidx + match_end] == dlm) {
            if (preserve_quotes_and_whitespaces) {
                result.push(match_obj[0]);
            } else {
                result.push(match_obj[1].replace(/""/g, '"'));
            }
            return [cidx + match_end + 1, false];
        }
        warning = true;
    }
    var uidx = src.indexOf(dlm, cidx);
    if (uidx == -1)
        uidx = src.length;
    var field = src.substring(cidx, uidx);
    warning = warning || field.indexOf('"') != -1;
    result.push(field);
    return [uidx + 1, warning];
}


function split_quoted_str(src, dlm, preserve_quotes_and_whitespaces=false) {
    // This function is newline-agnostic i.e. it can also split records with multiline fields.
    if (src.indexOf('"') == -1) // Optimization for most common case
        return [src.split(dlm), false];
    var result = [];
    var cidx = 0;
    var warning = false;
    let allow_external_whitespaces = dlm != ' ';
    while (cidx < src.length) {
        var extraction_report = extract_next_field(src, dlm, preserve_quotes_and_whitespaces, allow_external_whitespaces, cidx, result);
        cidx = extraction_report[0];
        warning = warning || extraction_report[1];
    }
    if (src.charAt(src.length - 1) == dlm)
        result.push('');
    return [result, warning];
}


function quote_field(src, delim) {
    if (src.indexOf(delim) != -1 || src.indexOf('"') != -1) {
        var escaped = src.replace(/"/g, '""');
        return `"${escaped}"`;
    }
    return src;
}


function rfc_quote_field(src, delim) {
    if (src.indexOf(delim) != -1 || src.indexOf('"') != -1 || src.indexOf('\n') != -1 || src.indexOf('\r') != -1) {
        var escaped = src.replace(/"/g, '""');
        return `"${escaped}"`;
    }
    return src;
}


function unquote_field(field) {
    let rgx = new RegExp('^' + ' *' + field_regular_expression + ' *$');
    let match_obj = rgx.exec(field);
    if (match_obj !== null) {
        return match_obj[1].replace(/""/g, '"');
    }
    return field;
}


function unquote_fields(fields) {
    return fields.map(unquote_field);
}


function split_whitespace_separated_str(src, preserve_whitespaces=false) {
    var rgxp = preserve_whitespaces ? new RegExp(' *[^ ]+ *', 'g') : new RegExp('[^ ]+', 'g');
    let result = [];
    let match_obj = null;
    while((match_obj = rgxp.exec(src)) !== null) {
        result.push(match_obj[0]);
    }
    if (preserve_whitespaces) {
        for (let i = 0; i < result.length - 1; i++) {
            result[i] = result[i].slice(0, -1);
        }
    }
    return result;
}


function smart_split(src, dlm, policy, preserve_quotes_and_whitespaces) {
    if (policy === 'simple')
        return [src.split(dlm), false];
    if (policy === 'whitespace')
        return [split_whitespace_separated_str(src, preserve_quotes_and_whitespaces), false];
    if (policy === 'monocolumn')
        return [[src], false];
    return split_quoted_str(src, dlm, preserve_quotes_and_whitespaces);
}


function accumulate_rfc_line_into_record(external_rfc_line_buffer, current_line, comment_prefix=null) {
    // Return null if the current line yields no record.
    // Return a record string if the current line yields the record and cleans the external line buffer.
    if (comment_prefix !== null && external_rfc_line_buffer.length == 0 && current_line.startsWith(comment_prefix))
        return null;
    let match_list = current_line.match(/"/g);
    let has_unbalanced_double_quote = match_list && match_list.length % 2 == 1;
    if (external_rfc_line_buffer.length == 0 && !has_unbalanced_double_quote) {
        return current_line;
    } else if (external_rfc_line_buffer.length == 0 && has_unbalanced_double_quote) {
        external_rfc_line_buffer.push(current_line);
    } else if (!has_unbalanced_double_quote) {
        external_rfc_line_buffer.push(current_line);
    } else {
        external_rfc_line_buffer.push(current_line);
        let multiline_row = external_rfc_line_buffer.join('\n');
        external_rfc_line_buffer.splice(0, external_rfc_line_buffer.length); // Cleanup the external buffer.
        return multiline_row;
    }
    return null;
}


module.exports.split_quoted_str = split_quoted_str;
module.exports.split_whitespace_separated_str = split_whitespace_separated_str;
module.exports.smart_split = smart_split;
module.exports.quote_field = quote_field;
module.exports.rfc_quote_field = rfc_quote_field;
module.exports.unquote_field = unquote_field;
module.exports.unquote_fields = unquote_fields;
module.exports.split_lines = split_lines;
module.exports.accumulate_rfc_line_into_record = accumulate_rfc_line_into_record;
