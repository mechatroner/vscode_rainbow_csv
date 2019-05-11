let field_regular_expression = '"((?:[^"]*"")*[^"]*)"';
let field_rgx = new RegExp('^' + field_regular_expression);
let field_rgx_external_whitespaces = new RegExp('^' + ' *'+ field_regular_expression + ' *')

function extract_next_field(src, dlm, preserve_quotes, allow_external_whitespaces, cidx, result) {
    var warning = false;
    let src_cur = src.substring(cidx);
    let rgx = allow_external_whitespaces ? field_rgx_external_whitespaces : field_rgx;
    let match_obj = rgx.exec(src_cur);
    if (match_obj !== null) {
        let match_end = match_obj[0].length;
        if (cidx + match_end == src.length || src[cidx + match_end] == dlm) {
            if (preserve_quotes) {
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


function split_quoted_str(src, dlm, preserve_quotes=false) {
    if (src.indexOf('"') == -1) // Optimization for most common case
        return [src.split(dlm), false];
    var result = [];
    var cidx = 0;
    var warning = false;
    let allow_external_whitespaces = dlm != ' ';
    while (cidx < src.length) {
        var extraction_report = extract_next_field(src, dlm, preserve_quotes, allow_external_whitespaces, cidx, result);
        cidx = extraction_report[0];
        warning = warning || extraction_report[1];
    }
    if (src.charAt(src.length - 1) == dlm)
        result.push('');
    return [result, warning];
}


function occurrences(string, subString, allowOverlapping=false) {
    // @author Vitim.us https://gist.github.com/victornpb/7736865

    string += "";
    subString += "";
    if (subString.length <= 0) return (string.length + 1);

    var n = 0,
        pos = 0,
        step = allowOverlapping ? 1 : subString.length;

    while (true) {
        pos = string.indexOf(subString, pos);
        if (pos >= 0) {
            ++n;
            pos += step;
        } else break;
    }
    return n;
}


function split_whitespace_separated_str(src, preserve_whitespaces=false) {
    var rgxp = preserve_whitespaces ? new RegExp(' *[^ ]+ *', 'g') : new RegExp('[^ ]+', 'g');
    let result = [];
    let match_obj = null;
    while((match_obj = rgxp.exec(src)) !== null) {
        result.push(match_obj[0]);
    }
    return result;
}


function smart_split(src, dlm, policy, preserve_quotes) {
    if (policy === 'simple')
        return [src.split(dlm), false];
    if (policy === 'monocolumn')
        return [[src], false];
    if (policy === 'whitespace')
        return [split_whitespace_separated_str(src, preserve_quotes), false];
    return split_quoted_str(src, dlm, preserve_quotes);
}


function MinAggregator() {
    this.stats = new Map();

    this.increment = function(key, val) {
        val = parseFloat(val);
        var cur_aggr = this.stats.get(key);
        if (cur_aggr === undefined) {
            this.stats.set(key, val);
        } else {
            this.stats.set(key, Math.min(cur_aggr, val));
        }
    }

    this.get_final = function(key) {
        return this.stats.get(key);
    }
}


function MaxAggregator() {
    this.stats = new Map();

    this.increment = function(key, val) {
        val = parseFloat(val);
        var cur_aggr = this.stats.get(key);
        if (cur_aggr === undefined) {
            this.stats.set(key, val);
        } else {
            this.stats.set(key, Math.max(cur_aggr, val));
        }
    }

    this.get_final = function(key) {
        return this.stats.get(key);
    }
}


function CountAggregator() {
    this.stats = new Map();

    this.increment = function(key, val) {
        var cur_aggr = this.stats.get(key);
        if (cur_aggr === undefined) {
            this.stats.set(key, 1);
        } else {
            this.stats.set(key, cur_aggr + 1);
        }
    }

    this.get_final = function(key) {
        return this.stats.get(key);
    }
}


function SumAggregator() {
    this.stats = new Map();

    this.increment = function(key, val) {
        val = parseFloat(val);
        var cur_aggr = this.stats.get(key);
        if (cur_aggr === undefined) {
            this.stats.set(key, val);
        } else {
            this.stats.set(key, cur_aggr + val);
        }
    }

    this.get_final = function(key) {
        return this.stats.get(key);
    }
}


function pretty_format(val) {
    if (val == 0)
        return '0.0'
    var res = val.toFixed(6);
    if (res.indexOf('.') != -1) {
        res = res.replace(/0*$/, '')
        if (res.endsWith('.')) {
            res += '0';
        }
    }
    return res;
}


function AvgAggregator() {
    this.stats = new Map();

    this.increment = function(key, val) {
        val = parseFloat(val);
        var cur_aggr = this.stats.get(key);
        if (cur_aggr === undefined) {
            this.stats.set(key, [val, 1]);
        } else {
            var cur_sum = cur_aggr[0];
            var cur_cnt = cur_aggr[1];
            this.stats.set(key, [cur_sum + val, cur_cnt + 1]);
        }
    }

    this.get_final = function(key) {
        var cur_aggr = this.stats.get(key);
        var cur_sum = cur_aggr[0];
        var cur_cnt = cur_aggr[1];
        var avg = cur_sum / cur_cnt;
        return pretty_format(avg);
    }
}


function VarianceAggregator() {
    this.stats = new Map();

    this.increment = function(key, val) {
        val = parseFloat(val);
        var cur_aggr = this.stats.get(key);
        if (cur_aggr === undefined) {
            this.stats.set(key, [val, val * val, 1]);
        } else {
            var cur_sum = cur_aggr[0];
            var cur_sum_sq = cur_aggr[1];
            var cur_cnt = cur_aggr[2];
            this.stats.set(key, [cur_sum + val, cur_sum_sq + val * val, cur_cnt + 1]);
        }
    }

    this.get_final = function(key) {
        var cur_aggr = this.stats.get(key);
        var cur_sum = cur_aggr[0];
        var cur_sum_sq = cur_aggr[1];
        var cur_cnt = cur_aggr[2];
        var avg_val = cur_sum / cur_cnt;
        var variance = cur_sum_sq / cur_cnt - avg_val * avg_val;
        return pretty_format(variance);
    }
}


function MedianAggregator() {
    this.stats = new Map();

    this.increment = function(key, val) {
        val = parseFloat(val);
        var cur_aggr = this.stats.get(key);
        if (cur_aggr === undefined) {
            this.stats.set(key, [val]);
        } else {
            cur_aggr.push(val);
            this.stats.set(key, cur_aggr); // Do we really need to do this? mutable cur_aggr already holds a reference to the value
        }
    }

    this.get_final = function(key) {
        var cur_aggr = this.stats.get(key);
        cur_aggr.sort(function(a, b) { return a - b; });
        var m = Math.floor(cur_aggr.length / 2);
        if (cur_aggr.length % 2) {
            return cur_aggr[m];
        } else {
            return (cur_aggr[m - 1] + cur_aggr[m]) / 2.0;
        }
    }
}


function FoldAggregator(post_proc) {
    this.post_proc = post_proc;
    this.stats = new Map();

    this.increment = function(key, val) {
        let cur_aggr = this.stats.get(key);
        if (cur_aggr === undefined) {
            this.stats.set(key, [val]);
        } else {
            cur_aggr.push(val);
            this.stats.set(key, cur_aggr); // Do we really need to do this? mutable cur_aggr already holds a reference to the value
        }
    }

    this.get_final = function(key) {
        let cur_aggr = this.stats.get(key);
        return this.post_proc(cur_aggr);
    }
}


function SubkeyChecker() {
    this.subkeys = new Map();

    this.increment = function(key, subkey) {
        var old_subkey = this.subkeys.get(key);
        if (old_subkey === undefined) {
            this.subkeys.set(key, subkey);
        } else if (old_subkey != subkey) {
            throw 'Unable to group by "' + key + '", different values in output: "' + old_subkey + '" and "' + subkey + '"';
        }
    }

    this.get_final = function(key) {
        return this.subkeys.get(key);
    }
}


module.exports.split_quoted_str = split_quoted_str;
module.exports.split_whitespace_separated_str = split_whitespace_separated_str;
module.exports.smart_split = smart_split;

module.exports.MinAggregator = MinAggregator;
module.exports.MaxAggregator = MaxAggregator;
module.exports.CountAggregator = CountAggregator;
module.exports.SumAggregator = SumAggregator;
module.exports.AvgAggregator = AvgAggregator;
module.exports.VarianceAggregator = VarianceAggregator;
module.exports.MedianAggregator = MedianAggregator;
module.exports.FoldAggregator = FoldAggregator;

module.exports.SubkeyChecker = SubkeyChecker;
