from collections import defaultdict

def extract_next_field(src, dlm, preserve_quotes, cidx, result):
    warning = False
    if (src[cidx] == '"'):
        uidx = src.find('"', cidx + 1)
        while uidx != -1 and uidx + 1 < len(src) and src[uidx + 1] == '"':
            uidx = src.find('"', uidx + 2)
        if uidx != -1 and (uidx + 1 == len(src) or src[uidx + 1] == dlm):
            if preserve_quotes:
                result.append(src[cidx:uidx + 1])
            else:
                result.append(src[cidx + 1:uidx].replace('""', '"'))
            return (uidx + 2, False)
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
    while cidx < len(src):
        extraction_report = extract_next_field(src, dlm, preserve_quotes, cidx, result)
        cidx = extraction_report[0]
        warning = warning or extraction_report[1]

    if src[-1] == dlm:
        result.append('')
    return (result, warning)


def unquote_field(field):
    if len(field) < 2:
        return field
    if field[0] == '"' and field[-1] == '"':
        candidate = field[1:-1]
        if candidate.count('"') == candidate.count('""') * 2:
            return candidate.replace('""', '"')
    return field


def unquote_fields(fields):
    return [unquote_field(f) for f in fields]


def rows(f, chunksize=1024, sep='\n'):
    incomplete_row = None
    while True:
        chunk = f.read(chunksize)
        if not chunk:
            if incomplete_row is not None and len(incomplete_row):
                yield incomplete_row
            return
        while True:
            i = chunk.find(sep)
            if i == -1:
                break
            if incomplete_row is not None:
                yield incomplete_row + chunk[:i]
                incomplete_row = None
            else:
                yield chunk[:i]
            chunk = chunk[i+1:]
        if incomplete_row is not None:
            incomplete_row += chunk
        else:
            incomplete_row = chunk


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
