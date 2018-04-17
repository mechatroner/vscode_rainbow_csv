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
    return split_quoted_str(src, dlm, preserve_quotes);
}


function adjust_window_borders(window_center, window_size, total_end) {
    // FIXME write unit tests for this function
    var window_begin = null;
    var window_end = null;
    if (window_size > window_center) {
        window_begin = 0;
        window_end = window_size;
    } else if (window_center + window_size >= total_end) {
        window_begin = total_end - window_size;
        window_end = total_end;
    } else {
        var half_window = Math.ceil(window_size / 2);
        window_begin = window_center - half_window;
        window_end = window_center + half_window;
    }
    window_begin = Math.max(window_begin, 0);
    window_end = Math.min(window_end, total_end);
    return [window_begin, window_end];
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


var entity_map = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};


module.exports.smart_split = smart_split;
module.exports.get_field_by_line_position = get_field_by_line_position;
module.exports.guess_if_header = guess_if_header;
module.exports.adjust_window_borders = adjust_window_borders;
