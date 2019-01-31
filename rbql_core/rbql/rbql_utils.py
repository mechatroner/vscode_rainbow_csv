import re
from collections import defaultdict

newline_rgx = re.compile('(?:\r\n)|\r|\n')

field_regular_expression = '"((?:[^"]*"")*[^"]*)"'
field_rgx = re.compile(field_regular_expression)
field_rgx_external_whitespaces = re.compile(' *'+ field_regular_expression + ' *')


def extract_next_field(src, dlm, preserve_quotes, allow_external_whitespaces, cidx, result):
    warning = False
    rgx = field_rgx_external_whitespaces if allow_external_whitespaces else field_rgx
    match_obj = rgx.match(src, cidx)
    if match_obj is not None:
        match_end = match_obj.span()[1]
        if match_end == len(src) or src[match_end] == dlm:
            if preserve_quotes:
                result.append(match_obj.group(0))
            else:
                result.append(match_obj.group(1).replace('""', '"'))
            return (match_end + 1, False)
        warning = True
    uidx = src.find(dlm, cidx)
    if uidx == -1:
        uidx = len(src)
    field = src[cidx:uidx]
    warning = warning or field.find('"') != -1
    result.append(field)
    return (uidx + 1, warning)



def split_quoted_str(src, dlm, preserve_quotes=False):
    assert dlm != '"'
    if src.find('"') == -1: # Optimization for most common case
        return (src.split(dlm), False)
    result = list()
    cidx = 0
    warning = False
    allow_external_whitespaces = dlm != ' '
    while cidx < len(src):
        extraction_report = extract_next_field(src, dlm, preserve_quotes, allow_external_whitespaces, cidx, result)
        cidx = extraction_report[0]
        warning = warning or extraction_report[1]

    if src[-1] == dlm:
        result.append('')
    return (result, warning)


def split_whitespace_separated_str(src, preserve_whitespaces=False):
    rgxp = re.compile(" *[^ ]+ *") if preserve_whitespaces else re.compile("[^ ]+")
    result = []
    for m in rgxp.finditer(src):
        result.append(m.group())
    return result


def smart_split(src, dlm, policy, preserve_quotes):
    if policy == 'simple':
        return (src.split(dlm), False)
    if policy == 'whitespace':
        return split_whitespace_separated_str(src, preserve_quotes)
    if policy == 'monocolumn':
        return ([src], False)
    return split_quoted_str(src, dlm, preserve_quotes)


def extract_line_from_data(data):
    mobj = newline_rgx.search(data)
    if mobj is None:
        return (None, None, data)
    pos_start, pos_end = mobj.span()
    str_before = data[:pos_start]
    str_after = data[pos_end:]
    return (str_before, mobj.group(0), str_after)


class LineIterator:
    # TODO treat src as binary input (bytes in python3) and explicitly decode to encoding. Add encoding param.
    # Use this hack for Windows: https://stackoverflow.com/a/38939320/2898283

    def __init__(self, src, chunk_size=1024):
        self.src = src
        self.buffer = ''
        self.chunk_size = chunk_size
        self.detected_line_separator = '\n'
        self.exhausted = False


    def _get_row_from_buffer(self):
        str_before, separator, str_after = extract_line_from_data(self.buffer)
        if separator is None:
            return None
        if separator == '\r' and str_after == '':
            one_more = self.src.read(1)
            if one_more == '\n':
                separator = '\r\n'
            else:
                str_after = one_more
        self.detected_line_separator = separator
        self.buffer = str_after
        return str_before


    def _read_until_found(self):
        if self.exhausted:
            return
        chunks = []
        while True:
            chunk = self.src.read(self.chunk_size)
            if not chunk:
                self.exhausted = True
                break
            chunks.append(chunk)
            if newline_rgx.search(chunk) is not None:
                break
        self.buffer += ''.join(chunks)
            

    def get_row(self):
        row = self._get_row_from_buffer()
        if row is not None:
            return row
        self._read_until_found()
        row = self._get_row_from_buffer()
        if row is None:
            assert self.exhausted
            if self.buffer:
                tmp = self.buffer
                self.buffer = ''
                return tmp
            return None
        return row


class NumHandler:
    def __init__(self):
        self.is_int = True
    
    def parse(self, str_val):
        if not self.is_int:
            return float(str_val)
        try:
            return int(str_val)
        except ValueError:
            self.is_int = False
            return float(str_val)


class MinAggregator:
    def __init__(self):
        self.stats = dict()
        self.num_handler = NumHandler()

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        cur_aggr = self.stats.get(key)
        if cur_aggr is None:
            self.stats[key] = val
        else:
            self.stats[key] = min(cur_aggr, val)

    def get_final(self, key):
        return self.stats[key]


class MaxAggregator:
    def __init__(self):
        self.stats = dict()
        self.num_handler = NumHandler()

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        cur_aggr = self.stats.get(key)
        if cur_aggr is None:
            self.stats[key] = val
        else:
            self.stats[key] = max(cur_aggr, val)

    def get_final(self, key):
        return self.stats[key]


class CountAggregator:
    def __init__(self):
        self.stats = defaultdict(int)

    def increment(self, key, val):
        self.stats[key] += 1

    def get_final(self, key):
        return self.stats[key]


class SumAggregator:
    def __init__(self):
        self.stats = defaultdict(int)
        self.num_handler = NumHandler()

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        self.stats[key] += val

    def get_final(self, key):
        return self.stats[key]


def pretty_format(val):
    if val == 0:
        return '0.0'
    if abs(val) < 1:
        return str(val)
    formatted = "{0:.6f}".format(val)
    if formatted.find('.') != -1:
        formatted = formatted.rstrip('0')
    if formatted.endswith('.'):
        formatted += '0'
    return formatted


class AvgAggregator:
    def __init__(self):
        self.stats = dict()

    def increment(self, key, val):
        val = float(val)
        cur_aggr = self.stats.get(key)
        if cur_aggr is None:
            self.stats[key] = (val, 1)
        else:
            cur_sum, cur_cnt = cur_aggr
            self.stats[key] = (cur_sum + val, cur_cnt + 1)

    def get_final(self, key):
        final_sum, final_cnt = self.stats[key]
        avg = float(final_sum) / final_cnt
        return pretty_format(avg)


class VarianceAggregator:
    def __init__(self):
        self.stats = dict()

    def increment(self, key, val):
        val = float(val)
        cur_aggr = self.stats.get(key)
        if cur_aggr is None:
            self.stats[key] = (val, val ** 2, 1)
        else:
            cur_sum, cur_sum_of_squares, cur_cnt = cur_aggr
            self.stats[key] = (cur_sum + val, cur_sum_of_squares + val ** 2, cur_cnt + 1)

    def get_final(self, key):
        final_sum, final_sum_of_squares, final_cnt = self.stats[key]
        variance = float(final_sum_of_squares) / final_cnt - (float(final_sum) / final_cnt) ** 2
        return pretty_format(variance)


class FoldAggregator:
    def __init__(self, post_proc):
        self.stats = defaultdict(list)
        self.post_proc = post_proc

    def increment(self, key, val):
        self.stats[key].append(val)

    def get_final(self, key):
        res = self.stats[key]
        return self.post_proc(res)


class MedianAggregator:
    def __init__(self):
        self.stats = defaultdict(list)
        self.num_handler = NumHandler()

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        self.stats[key].append(val)

    def get_final(self, key):
        sorted_vals = sorted(self.stats[key])
        assert len(sorted_vals)
        m = int(len(sorted_vals) / 2)
        if len(sorted_vals) % 2:
            return sorted_vals[m]
        else:
            a = sorted_vals[m - 1]
            b = sorted_vals[m]
            return a if a == b else (a + b) / 2.0


class SubkeyChecker:
    def __init__(self):
        self.subkeys = dict()

    def increment(self, key, subkey):
        old_subkey = self.subkeys.get(key)
        if old_subkey is None:
            self.subkeys[key] = subkey
        elif old_subkey != subkey:
            raise RuntimeError('Unable to group by "{}", different values in output: "{}" and "{}"'.format(key, old_subkey, subkey))

    def get_final(self, key):
        return self.subkeys[key]
