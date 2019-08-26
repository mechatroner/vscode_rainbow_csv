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

# Aggregators:
aggregation_stage = 0
functional_aggregators = list()

writer = None

NU = 0 # NU - Num Updated. Alternative variables: NW (Num Where) - Not Practical. NW (Num Written) - Impossible to implement.


wrong_aggregation_usage_error = 'Usage of RBQL aggregation functions inside Python expressions is not allowed, see the docs'
numeric_conversion_error = 'Unable to convert value "{}" to int or float. MIN, MAX, SUM, AVG, MEDIAN and VARIANCE aggregate functions convert their string arguments to numeric values'


def iteritems6(x):
    if PY3:
        return x.items()
    return x.iteritems()


class InternalBadFieldError(Exception):
    def __init__(self, bad_idx):
        self.bad_idx = bad_idx


class RbqlRuntimeError(Exception):
    pass


class RbqlParsingError(Exception):
    pass


def safe_get(record, idx):
    return record[idx] if idx < len(record) else None


def safe_join_get(record, idx):
    try:
        return record[idx]
    except IndexError as e:
        raise InternalBadFieldError(idx)


def safe_set(record, idx, value):
    try:
        record[idx - 1] = value
    except IndexError as e:
        raise InternalBadFieldError(idx - 1)


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
            raise RbqlParsingError('Only one UNNEST is allowed per query')
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
            raise RbqlRuntimeError(numeric_conversion_error.format(val))


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
    def __init__(self, post_proc):
        self.stats = defaultdict(list)
        self.post_proc = post_proc

    def increment(self, key, val):
        self.stats[key].append(val)

    def get_final(self, key):
        res = self.stats[key]
        return self.post_proc(res)


class ConstGroupVerifier:
    def __init__(self, output_index):
        self.const_values = dict()
        self.output_index = output_index

    def increment(self, key, value):
        old_value = self.const_values.get(key)
        if old_value is None:
            self.const_values[key] = value
        elif old_value != value:
            raise RbqlRuntimeError('Invalid aggregate expression: non-constant values in output column {}. E.g. "{}" and "{}"'.format(self.output_index + 1, old_value, value))

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


def ARRAY_AGG(val, post_proc=lambda v: '|'.join(v)):
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


class FakeJoiner(object):
    def __init__(self, join_map):
        pass

    def get_rhs(self, lhs_key):
        return [None]


class InnerJoiner(object):
    def __init__(self, join_map):
        self.join_map = join_map

    def get_rhs(self, lhs_key):
        return self.join_map.get_join_records(lhs_key)


class LeftJoiner(object):
    def __init__(self, join_map):
        self.join_map = join_map
        self.null_record = [[None] * join_map.max_record_len]

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
            raise RbqlRuntimeError('In "STRICT LEFT JOIN" each key in A must have exactly one match in B. Bad A key: "' + lhs_key + '"')
        return result


def select_except(src, except_fields):
    result = list()
    for i, v in enumerate(src):
        if i not in except_fields:
            result.append(v)
    return result


def process_update(NR, NF, afields, rhs_records):
    if len(rhs_records) > 1:
        raise RbqlRuntimeError('More than one record in UPDATE query matched A-key in join table B')
    bfields = None
    if len(rhs_records) == 1:
        bfields = rhs_records[0]
    up_fields = afields[:]
    __RBQLMP__init_column_vars_update
    if len(rhs_records) == 1 and (__RBQLMP__where_expression):
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
            raise RbqlParsingError('Unable to use "ORDER BY" or "DISTINCT" keywords in aggregate query')
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
            raise RbqlParsingError(wrong_aggregation_usage_error)
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


def process_select(NR, NF, afields, rhs_records):
    global unnest_list
    for bfields in rhs_records:
        unnest_list = None
        if bfields is None:
            star_fields = afields
        else:
            star_fields = afields + bfields
        __RBQLMP__init_column_vars_select
        if not (__RBQLMP__where_expression):
            continue
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


def rb_transform(input_iterator, join_map_impl, output_writer):
    global module_was_used_failsafe
    assert not module_was_used_failsafe
    module_was_used_failsafe = True

    global writer

    polymorphic_process = process_select if __RBQLMP__is_select_query else process_update
    sql_join_type = {'VOID': FakeJoiner, 'JOIN': InnerJoiner, 'INNER JOIN': InnerJoiner, 'LEFT JOIN': LeftJoiner, 'STRICT LEFT JOIN': StrictLeftJoiner}['__RBQLMP__join_operation']

    if join_map_impl is not None:
        join_map_impl.build()
    join_map = sql_join_type(join_map_impl)

    writer = TopWriter(output_writer)

    if '__RBQLMP__writer_type' == 'uniq':
        writer = UniqWriter(writer)
    elif '__RBQLMP__writer_type' == 'uniq_count':
        writer = UniqCountWriter(writer)

    if __RBQLMP__sort_flag:
        writer = SortedWriter(writer)

    NR = 0
    while True:
        afields = input_iterator.get_record()
        if afields is None:
            break
        NR += 1
        NF = len(afields)
        try:
            rhs_records = join_map.get_rhs(__RBQLMP__lhs_join_var)
            if not polymorphic_process(NR, NF, afields, rhs_records):
                break
        except InternalBadFieldError as e:
            bad_idx = e.bad_idx
            raise RbqlRuntimeError('No "a' + str(bad_idx + 1) + '" field at record: ' + str(NR))
        except RbqlParsingError:
            raise
        except Exception as e:
            if str(e).find('RBQLAggregationToken') != -1:
                raise RbqlParsingError(wrong_aggregation_usage_error)
            raise RbqlRuntimeError('At record: ' + str(NR) + ', Details: ' + str(e))
    writer.finish()
    return True


