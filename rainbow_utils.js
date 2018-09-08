function extract_next_field(src, dlm, preserve_quotes, cidx, result) {
    var warning = false;
    if (src.charAt(cidx) === '"') {
        var uidx = src.indexOf('"', cidx + 1);
        while (uidx != -1 && uidx + 1 < src.length && src.charAt(uidx + 1) == '"') {
            uidx = src.indexOf('"', uidx + 2);
        }
        if (uidx != -1 && (uidx + 1 == src.length || src.charAt(uidx + 1) == dlm)) {
            if (preserve_quotes) {
                result.push(src.substring(cidx, uidx + 1));
            } else {
                result.push(src.substring(cidx + 1, uidx).replace(/""/g, '"'));
            }
            return [uidx + 2, false];
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


function split_quoted_str(src, dlm, preserve_quotes=false) {
    if (src.indexOf('"') == -1) // Optimization for most common case
        return [src.split(dlm), false];
    var result = [];
    var cidx = 0;
    var warning = false;
    while (cidx < src.length) {
        var extraction_report = extract_next_field(src, dlm, preserve_quotes, cidx, result);
        cidx = extraction_report[0];
        warning = warning || extraction_report[1];
    }
    if (src.charAt(src.length - 1) == dlm)
        result.push('');
    return [result, warning];
}


function smart_split(src, dlm, policy, preserve_quotes) {
    if (policy === 'simple')
        return [src.split(dlm), false];
    if (policy === 'monocolumn')
        return [[src], false];
    return split_quoted_str(src, dlm, preserve_quotes);
}


function get_field_by_line_position(fields, query_pos) {
    if (!fields.length)
        return null;
    var col_num = 0;
    var cpos = fields[col_num].length + 1;
    while (query_pos > cpos && col_num + 1 < fields.length) {
        col_num += 1;
        cpos = cpos + fields[col_num].length + 1;
    }
    return col_num;
}


module.exports.smart_split = smart_split;
module.exports.get_field_by_line_position = get_field_by_line_position;
