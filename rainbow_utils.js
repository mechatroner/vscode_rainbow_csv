function split_quoted_str(src, dlm, preserve_quotes=false) {
    if (src.indexOf('"') == -1)
        return [src.split(dlm), false];
    var result = [];
    var cidx = 0;
    while (cidx < src.length) {
        if (src.charAt(cidx) === '"') {
            var uidx = cidx + 1;
            while (true) {
                uidx = src.indexOf('"', uidx);
                if (uidx == -1) {
                    result.push(src.substring(cidx));
                    return [result, true];
                } else if (uidx + 1 == src.length || src.charAt(uidx + 1) == dlm) {
                    if (preserve_quotes) {
                        result.push(src.substring(cidx, uidx + 1));
                    } else {
                        result.push(src.substring(cidx + 1, uidx).replace(/""/g, '"'));
                    }
                    cidx = uidx + 2;
                    break;
                } else if (src.charAt(uidx + 1) == '"') {
                    uidx += 2; 
                    continue;
                } else {
                    result.push(src.substring(cidx));
                    return [result, true];
                }
            }
        } else {
            var uidx = src.indexOf(dlm, cidx);
            if (uidx == -1)
                uidx = src.length;
            var field = src.substring(cidx, uidx);
            if (field.indexOf('"') != -1) {
                result.push(src.substring(cidx));
                return [result, true];
            }
            result.push(field);
            cidx = uidx + 1;
        }
    }
    if (src.charAt(src.length - 1) == dlm)
        result.push('');
    return [result, false];
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
