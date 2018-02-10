function split_simple_str(src, dlm, query_position_idx) {
    var query_result = null;
    var fields = src.split(dlm);
    var total_len = 0;
    for (var i = 0; i < fields.length; i++) {
        total_len += fields[i].length + 1;
        if (query_result === null && query_position_idx < total_len) {
            query_result = i;
        }
    }
    if (query_result === null) {
        query_result = fields.length - 1;
    }
    return [fields, false, query_result];
}


function split_quoted_str(src, dlm, query_position_idx) {
    if (src.indexOf('"') == -1) {
        return split_simple_str(src, dlm, query_position_idx);
    }
    var result = [];
    var warning = false;
    var cidx = 0;
    var query_result = null;
    while (cidx < src.length) {
        if (src.charAt(cidx) === '"') {
            var uidx = cidx + 1;
            while (true) {
                uidx = src.indexOf('"', uidx);
                if (uidx == -1) {
                    if (query_result === null)
                        query_result = result.length;
                    result.push(src.substring(cidx + 1).replace(/""/g, '"'));
                    return [result, true, query_result];
                } else if (uidx + 1 >= src.length || src.charAt(uidx + 1) == dlm) {
                    if (query_result === null && query_position_idx <= uidx + 1) {
                        query_result = result.length;
                    }
                    result.push(src.substring(cidx + 1, uidx).replace(/""/g, '"'));
                    cidx = uidx + 2;
                    break;
                } else if (src.charAt(uidx + 1) == '"') {
                    uidx += 2; 
                    continue;
                } else {
                    warning = true;
                    uidx += 1;
                    continue;
                }
            }
        } else {
            var uidx = src.indexOf(dlm, cidx);
            if (uidx == -1)
                uidx = src.length;
            var field = src.substring(cidx, uidx);
            if (query_result === null && query_position_idx <= uidx) {
                query_result = result.length;
            }
            if (field.indexOf('"') != -1)
                warning = true;
            result.push(field);
            cidx = uidx + 1;
        }
    }
    if (src.charAt(src.length - 1) == dlm) {
        if (query_result === null) {
            query_result = result.length;
        }
        result.push('');
    }
    return [result, warning, query_result];
}


function guess_if_header(potential_header, sampled_records) {
    // single line - not header
    if (sampled_records.length < 1)
        return false;

    // different number of columns - not header
    var num_fields = potential_header.length;
    for (var i = 0; i < sampled_records.length; i++) {
        if (sampled_records[i].length != num_fields)
            return false;
    }

    // all sampled lines do not have any letters in a column and potential header does - header
    var optimistic_name_re = /^[a-zA-Z]{3,}/;
    var pessimistic_name_re = /[a-zA-Z]/;
    for (var c = 0; c < num_fields; c++) {
        if (potential_header[c].match(optimistic_name_re) === null)
            continue;
        var all_numbers = true;
        for (var r = 0; r < sampled_records.length; r++) {
            if (sampled_records[r][c].match(pessimistic_name_re) !== null) {
                all_numbers = false;
                break;
            }
        }
        if (all_numbers)
            return true;
    }
    return false;
}


module.exports.split_simple_str = split_simple_str;
module.exports.split_quoted_str = split_quoted_str;
module.exports.guess_if_header = guess_if_header;
