# -*- coding: utf-8 -*-
from __future__ import unicode_literals
from __future__ import print_function
import sys
import os
import random # For random sort
import datetime # For date manipulations
import re # For regexes
import math
from collections import OrderedDict, defaultdict


# This module must be both python2 and python3 compatible

# This module works with records only. It is CSV-agnostic. 
# Do not add CSV-related logic or variables/functions/objects like "delim", "separator", "split", "line", "path" etc


try:
    pass
__RBQLMP__user_init_code
except Exception as e:
    raise RuntimeError('Exception while executing user-provided init code: {}'.format(e))


PY3 = sys.version_info[0] == 3

unnest_list = None

module_was_used_failsafe = False

aggregation_stage = 0
functional_aggregators = list()

writer = None

NU = 0 # NU - Num Updated. Alternative variables: NW (Num Where) - Not Practical. NW (Num Written) - Impossible to implement.


wrong_aggregation_usage_error = 'Usage of RBQL aggregation functions inside Python expressions is not allowed, see the docs'
numeric_conversion_error = 'Unable to convert value "{}" to int or float. MIN, MAX, SUM, AVG, MEDIAN and VARIANCE aggregate functions convert their string arguments to numeric values'


debug_mode = False


def iteritems6(x):
    if PY3:
        return x.items()
    return x.iteritems()


class InternalBadFieldError(Exception):
    def __init__(self, bad_idx):
        self.bad_idx = bad_idx


class InternalBadKeyError(Exception):
    def __init__(self, bad_key):
        self.bad_key = bad_key


class RbqlRuntimeError(Exception):
    pass


class RbqlParsingError(Exception):
    pass


class RBQLRecord:
    def __init__(self):
        self.storage = dict()

    def __getitem__(self, key):
        try:
            return self.storage[key]
        except KeyError:
            raise InternalBadKeyError(key)

    def __setitem__(self, key, value):
        self.storage[key] = value


def safe_get(record, idx):
    return record[idx] if idx < len(record) else None


def safe_join_get(record, idx):
    try:
        return record[idx]
    except IndexError as e:
        raise InternalBadFieldError(idx)


def safe_set(record, idx, value):
    try:
        record[idx] = value
    except IndexError as e:
        raise InternalBadFieldError(idx)


class RBQLAggregationToken(object):
    def __init__(self, marker_id, value):
        self.marker_id = marker_id
        self.value = value

    def __str__(self):
        raise TypeError('RBQLAggregationToken')


class UNNEST:
    def __init__(self, vals):
        global unnest_list
        if unnest_list is not None:
            # Technically we can support multiple UNNEST's but the implementation/algorithm is more complex and just doesn't worth it
            raise RbqlParsingError('Only one UNNEST is allowed per query') # UT JSON
        unnest_list = vals

    def __str__(self):
        raise TypeError('UNNEST')

unnest = UNNEST
Unnest = UNNEST
UNFOLD = UNNEST # "UNFOLD" is deprecated, just for backward compatibility


class NumHandler:
    def __init__(self, start_with_int):
        self.is_int = start_with_int
        self.string_detection_done = False
        self.is_str = False
    
    def parse(self, val):
        if not self.string_detection_done:
            self.string_detection_done = True
            if PY3 and isinstance(val, str):
                self.is_str = True
            if not PY3 and isinstance(val, basestring):
                self.is_str = True
        if not self.is_str:
            return val
        if self.is_int:
            try:
                return int(val)
            except ValueError:
                self.is_int = False
        try:
            return float(val)
        except ValueError:
            raise RbqlRuntimeError(numeric_conversion_error.format(val)) # UT JSON


class MinAggregator:
    def __init__(self):
        self.stats = dict()
        self.num_handler = NumHandler(True)

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        cur_aggr = self.stats.get(key)
        if cur_aggr is None:
            self.stats[key] = val
        else:
            self.stats[key] = builtin_min(cur_aggr, val)

    def get_final(self, key):
        return self.stats[key]


class MaxAggregator:
    def __init__(self):
        self.stats = dict()
        self.num_handler = NumHandler(True)

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        cur_aggr = self.stats.get(key)
        if cur_aggr is None:
            self.stats[key] = val
        else:
            self.stats[key] = builtin_max(cur_aggr, val)

    def get_final(self, key):
        return self.stats[key]


class SumAggregator:
    def __init__(self):
        self.stats = defaultdict(int)
        self.num_handler = NumHandler(True)

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        self.stats[key] += val

    def get_final(self, key):
        return self.stats[key]


class AvgAggregator:
    def __init__(self):
        self.stats = dict()
        self.num_handler = NumHandler(False)

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        cur_aggr = self.stats.get(key)
        if cur_aggr is None:
            self.stats[key] = (val, 1)
        else:
            cur_sum, cur_cnt = cur_aggr
            self.stats[key] = (cur_sum + val, cur_cnt + 1)

    def get_final(self, key):
        final_sum, final_cnt = self.stats[key]
        return float(final_sum) / final_cnt


class VarianceAggregator:
    def __init__(self):
        self.stats = dict()
        self.num_handler = NumHandler(False)

    def increment(self, key, val):
        val = self.num_handler.parse(val)
        cur_aggr = self.stats.get(key)
        if cur_aggr is None:
            self.stats[key] = (val, val ** 2, 1)
        else:
            cur_sum, cur_sum_of_squares, cur_cnt = cur_aggr
            self.stats[key] = (cur_sum + val, cur_sum_of_squares + val ** 2, cur_cnt + 1)

    def get_final(self, key):
        final_sum, final_sum_of_squares, final_cnt = self.stats[key]
        return float(final_sum_of_squares) / final_cnt - (float(final_sum) / final_cnt) ** 2


class MedianAggregator:
    def __init__(self):
        self.stats = defaultdict(list)
        self.num_handler = NumHandler(True)

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


class CountAggregator:
    def __init__(self):
        self.stats = defaultdict(int)

    def increment(self, key, val):
        self.stats[key] += 1

    def get_final(self, key):
        return self.stats[key]


class ArrayAggAggregator:
    def __init__(self, post_proc=None):
        self.stats = defaultdict(list)
        self.post_proc = post_proc

    def increment(self, key, val):
        self.stats[key].append(val)

    def get_final(self, key):
        res = self.stats[key]
        if self.post_proc is not None:
            return self.post_proc(res)
        return res


class ConstGroupVerifier:
    def __init__(self, output_index):
        self.const_values = dict()
        self.output_index = output_index

    def increment(self, key, value):
        old_value = self.const_values.get(key)
        if old_value is None:
            self.const_values[key] = value
        elif old_value != value:
            raise RbqlRuntimeError('Invalid aggregate expression: non-constant values in output column {}. E.g. "{}" and "{}"'.format(self.output_index + 1, old_value, value)) # UT JSON

    def get_final(self, key):
        return self.const_values[key]


def init_aggregator(generator_name, val, post_proc=None):
    global aggregation_stage
    aggregation_stage = 1
    res = RBQLAggregationToken(len(functional_aggregators), val)
    if post_proc is not None:
        functional_aggregators.append(generator_name(post_proc))
    else:
        functional_aggregators.append(generator_name())
    return res


def MIN(val):
    return init_aggregator(MinAggregator, val) if aggregation_stage < 2 else val

# min = MIN - see the mad max copypaste below
Min = MIN


def MAX(val):
    return init_aggregator(MaxAggregator, val) if aggregation_stage < 2 else val

# max = MAX - see the mad max copypaste below
Max = MAX 


def COUNT(val):
    return init_aggregator(CountAggregator, 1) if aggregation_stage < 2 else 1

count = COUNT
Count = COUNT


def SUM(val):
    return init_aggregator(SumAggregator, val) if aggregation_stage < 2 else val

# sum = SUM - see the mad max copypaste below
Sum = SUM


def AVG(val):
    return init_aggregator(AvgAggregator, val) if aggregation_stage < 2 else val

avg = AVG
Avg = AVG


def VARIANCE(val):
    return init_aggregator(VarianceAggregator, val) if aggregation_stage < 2 else val

variance = VARIANCE
Variance = VARIANCE


def MEDIAN(val):
    return init_aggregator(MedianAggregator, val) if aggregation_stage < 2 else val

median = MEDIAN
Median = MEDIAN


def ARRAY_AGG(val, post_proc=None):
    # TODO consider passing array to output writer
    return init_aggregator(ArrayAggAggregator, val, post_proc) if aggregation_stage < 2 else val

array_agg = ARRAY_AGG
FOLD = ARRAY_AGG # "FOLD" is deprecated, just for backward compatibility


# <<<< COPYPASTE FROM "mad_max.py"
#####################################
#####################################
# This is to ensure that "mad_max.py" file has exactly the same content as this fragment. This condition will be ensured by test_mad_max.py
# To edit this code you need to simultaneously edit this fragment and content of mad_max.py, otherwise test_mad_max.py will fail.

builtin_max = max
builtin_min = min
builtin_sum = sum


def max(*args, **kwargs):
    single_arg = len(args) == 1 and not kwargs
    if single_arg:
        if PY3 and isinstance(args[0], str):
            return MAX(args[0])
        if not PY3 and isinstance(args[0], basestring):
            return MAX(args[0])
        if isinstance(args[0], int) or isinstance(args[0], float):
            return MAX(args[0])
    try:
        return builtin_max(*args, **kwargs)
    except TypeError:
        if single_arg:
            return MAX(args[0])
        raise


def min(*args, **kwargs):
    single_arg = len(args) == 1 and not kwargs
    if single_arg:
        if PY3 and isinstance(args[0], str):
            return MIN(args[0])
        if not PY3 and isinstance(args[0], basestring):
            return MIN(args[0])
        if isinstance(args[0], int) or isinstance(args[0], float):
            return MIN(args[0])
    try:
        return builtin_min(*args, **kwargs)
    except TypeError:
        if single_arg:
            return MIN(args[0])
        raise


def sum(*args):
    try:
        return builtin_sum(*args)
    except TypeError:
        if len(args) == 1:
            return SUM(args[0])
        raise

#####################################
#####################################
# >>>> COPYPASTE END



def add_to_set(dst_set, value):
    len_before = len(dst_set)
    dst_set.add(value)
    return len_before != len(dst_set)


class TopWriter(object):
    def __init__(self, subwriter):
        self.subwriter = subwriter
        self.NW = 0

    def write(self, record):
        if __RBQLMP__top_count is not None and self.NW >= __RBQLMP__top_count:
            return False
        self.subwriter.write(record)
        self.NW += 1
        return True

    def finish(self):
        self.subwriter.finish()


class UniqWriter(object):
    def __init__(self, subwriter):
        self.subwriter = subwriter
        self.seen = set()

    def write(self, record):
        immutable_record = tuple(record)
        if not add_to_set(self.seen, immutable_record):
            return True
        if not self.subwriter.write(record):
            return False
        return True

    def finish(self):
        self.subwriter.finish()


class UniqCountWriter(object):
    def __init__(self, subwriter):
        self.subwriter = subwriter
        self.records = OrderedDict()

    def write(self, record):
        record = tuple(record)
        if record in self.records:
            self.records[record] += 1
        else:
            self.records[record] = 1
        return True

    def finish(self):
        for record, count in iteritems6(self.records):
            mutable_record = list(record)
            mutable_record.insert(0, count)
            if not self.subwriter.write(mutable_record):
                break
        self.subwriter.finish()


class SortedWriter(object):
    def __init__(self, subwriter):
        self.subwriter = subwriter
        self.unsorted_entries = list()

    def write(self, sort_key_value, record):
        self.unsorted_entries.append((sort_key_value, record))
        return True

    def finish(self):
        sorted_entries = sorted(self.unsorted_entries, key=lambda x: x[0])
        if __RBQLMP__reverse_flag:
            sorted_entries.reverse()
        for e in sorted_entries:
            if not self.subwriter.write(e[1]):
                break
        self.subwriter.finish()


class AggregateWriter(object):
    def __init__(self, subwriter):
        self.subwriter = subwriter
        self.aggregators = []
        self.aggregation_keys = set()

    def finish(self):
        all_keys = sorted(list(self.aggregation_keys))
        for key in all_keys:
            out_fields = [ag.get_final(key) for ag in self.aggregators]
            if not self.subwriter.write(out_fields):
                break
        self.subwriter.finish()


class InnerJoiner(object):
    def __init__(self, join_map):
        self.join_map = join_map

    def get_rhs(self, lhs_key):
        return self.join_map.get_join_records(lhs_key)


class LeftJoiner(object):
    def __init__(self, join_map):
        self.join_map = join_map
        self.null_record = [(None, join_map.max_record_len, [None] * join_map.max_record_len)]

    def get_rhs(self, lhs_key):
        result = self.join_map.get_join_records(lhs_key)
        if len(result) == 0:
            return self.null_record
        return result


class StrictLeftJoiner(object):
    def __init__(self, join_map):
        self.join_map = join_map

    def get_rhs(self, lhs_key):
        result = self.join_map.get_join_records(lhs_key)
        if len(result) != 1:
            raise RbqlRuntimeError('In "STRICT LEFT JOIN" each key in A must have exactly one match in B. Bad A key: "' + lhs_key + '"') # UT JSON
        return result


def select_except(src, except_fields):
    result = list()
    for i, v in enumerate(src):
        if i not in except_fields:
            result.append(v)
    return result


def process_update_join(NR, NF, record_a, join_matches):
    if len(join_matches) > 1:
        raise RbqlRuntimeError('More than one record in UPDATE query matched a key from the input table in the join table') # UT JSON # TODO output the failed key
    if len(join_matches) == 1:
        bNR, bNF, record_b = join_matches[0]
    else:
        bNR, bNF, record_b = None, None, None
    up_fields = record_a[:]
    __RBQLMP__init_column_vars_update
    if len(join_matches) == 1 and (__RBQLMP__where_expression):
        global NU
        NU += 1
        __RBQLMP__update_statements
    return writer.write(up_fields)


def process_update_simple(NR, NF, record_a, _join_matches):
    # TODO refactoring, do not pass _join_matches at all
    up_fields = record_a[:]
    __RBQLMP__init_column_vars_update
    if __RBQLMP__where_expression:
        global NU
        NU += 1
        __RBQLMP__update_statements
    return writer.write(up_fields)


def select_simple(sort_key, out_fields):
    if __RBQLMP__sort_flag:
        if not writer.write(sort_key, out_fields):
            return False
    else:
        if not writer.write(out_fields):
            return False
    return True


def select_aggregated(key, transparent_values):
    global aggregation_stage
    if aggregation_stage == 1:
        global writer
        if type(writer) is not TopWriter:
            raise RbqlParsingError('"ORDER BY", "UPDATE" and "DISTINCT" keywords are not allowed in aggregate queries') # UT JSON (the same error can be triggered statically, see builder.py)
        writer = AggregateWriter(writer)
        num_aggregators_found = 0
        for i, trans_value in enumerate(transparent_values):
            if isinstance(trans_value, RBQLAggregationToken):
                num_aggregators_found += 1
                writer.aggregators.append(functional_aggregators[trans_value.marker_id])
                writer.aggregators[-1].increment(key, trans_value.value)
            else:
                writer.aggregators.append(ConstGroupVerifier(len(writer.aggregators)))
                writer.aggregators[-1].increment(key, trans_value)
        if num_aggregators_found != len(functional_aggregators):
            raise RbqlParsingError(wrong_aggregation_usage_error) # UT JSON
        aggregation_stage = 2
    else:
        for i, trans_value in enumerate(transparent_values):
            writer.aggregators[i].increment(key, trans_value)
    writer.aggregation_keys.add(key)


def select_unnested(sort_key, folded_fields):
    unnest_pos = None
    for i, trans_value in enumerate(folded_fields):
        if isinstance(trans_value, UNNEST):
            unnest_pos = i
            break
    assert unnest_pos is not None
    for v in unnest_list:
        out_fields = folded_fields[:]
        out_fields[unnest_pos] = v
        if not select_simple(sort_key, out_fields):
            return False
    return True


def process_select_simple(NR, NF, record_a, join_match):
    global unnest_list
    unnest_list = None
    if join_match is None:
        star_fields = record_a
    else:
        bNR, bNF, record_b = join_match
        star_fields = record_a + record_b
    __RBQLMP__init_column_vars_select
    if not (__RBQLMP__where_expression):
        return True
    out_fields = __RBQLMP__select_expression
    if aggregation_stage > 0:
        key = __RBQLMP__aggregation_key_expression
        select_aggregated(key, out_fields)
    else:
        sort_key = (__RBQLMP__sort_key_expression)
        if unnest_list is not None:
            if not select_unnested(sort_key, out_fields):
                return False
        else:
            if not select_simple(sort_key, out_fields):
                return False
    return True


def process_select_join(NR, NF, record_a, join_matches):
    for join_match in join_matches:
        if not process_select_simple(NR, NF, record_a, join_match):
            return False
    return True


def rb_transform(input_iterator, join_map_impl, output_writer):
    global module_was_used_failsafe
    assert not module_was_used_failsafe
    module_was_used_failsafe = True

    global writer
    writer = TopWriter(output_writer)
    if __RBQLMP__writer_type == 'uniq':
        writer = UniqWriter(writer)
    elif __RBQLMP__writer_type == 'uniq_count':
        writer = UniqCountWriter(writer)
    if __RBQLMP__sort_flag:
        writer = SortedWriter(writer)

    polymorphic_process = [[process_update_simple, process_update_join], [process_select_simple, process_select_join]][__RBQLMP__is_select_query][join_map_impl is not None];

    assert (join_map_impl is None) == (__RBQLMP__join_operation is None)
    join_map = None
    if join_map_impl is not None:
        join_map_impl.build()
        sql_join_type = {'JOIN': InnerJoiner, 'INNER JOIN': InnerJoiner, 'LEFT JOIN': LeftJoiner, 'STRICT LEFT JOIN': StrictLeftJoiner}[__RBQLMP__join_operation]
        join_map = sql_join_type(join_map_impl)

    NR = 0
    while True:
        record_a = input_iterator.get_record()
        if record_a is None:
            break
        NR += 1
        NF = len(record_a)
        try:
            join_matches = None if join_map is None else join_map.get_rhs(__RBQLMP__lhs_join_var)
            if not polymorphic_process(NR, NF, record_a, join_matches):
                break
        except InternalBadKeyError as e:
            raise RbqlRuntimeError('No "{}" field at record {}'.format(e.bad_key, NR)) # UT JSON
        except InternalBadFieldError as e:
            raise RbqlRuntimeError('No "a{}" field at record {}'.format(e.bad_idx + 1, NR)) # UT JSON
        except RbqlParsingError:
            raise
        except Exception as e:
            if debug_mode:
                raise
            if str(e).find('RBQLAggregationToken') != -1:
                raise RbqlParsingError(wrong_aggregation_usage_error) # UT JSON
            raise RbqlRuntimeError('At record ' + str(NR) + ', Details: ' + str(e)) # UT JSON
    writer.finish()


def set_debug_mode():
    global debug_mode
    debug_mode = True

