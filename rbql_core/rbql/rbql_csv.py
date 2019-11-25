# -*- coding: utf-8 -*-
from __future__ import unicode_literals
from __future__ import print_function

import sys
import os
import codecs
import io
import re

from . import engine
from . import csv_utils


PY3 = sys.version_info[0] == 3

default_csv_encoding = 'utf-8'

user_home_dir = os.path.expanduser('~')
table_names_settings_path = os.path.join(user_home_dir, '.rbql_table_names')


# TODO performance improvement: replace smart_split() with polymorphic_split()


polymorphic_xrange = range if PY3 else xrange


debug_mode = False


class RbqlIOHandlingError(Exception):
    pass

class RbqlParsingError(Exception):
    pass


def is_ascii(s):
    return all(ord(c) < 128 for c in s)


def read_user_init_code(rbql_init_source_path):
    with open(rbql_init_source_path) as src:
        return src.read()


def normalize_delim(delim):
    if delim == 'TAB':
        return '\t'
    if delim == r'\t':
        return '\t'
    return delim


def interpret_named_csv_format(format_name):
    format_name = format_name.lower()
    if format_name == 'monocolumn':
        return ('', 'monocolumn')
    if format_name == 'csv':
        return (',', 'quoted')
    if format_name == 'tsv':
        return ('\t', 'simple')
    raise RuntimeError('Unknown format name: "{}"'.format(format_name))



def encode_input_stream(stream, encoding):
    if encoding is None:
        return stream
    if PY3:
        # Reference: https://stackoverflow.com/a/16549381/2898283
        # typical stream (e.g. sys.stdin) in Python 3 is actually a io.TextIOWrapper but with some unknown encoding
        try:
            return io.TextIOWrapper(stream.buffer, encoding=encoding)
        except AttributeError:
            # BytesIO doesn't have "buffer"
            return io.TextIOWrapper(stream, encoding=encoding)
    else:
        # Reference: https://stackoverflow.com/a/27425797/2898283
        # Python 2 streams don't have stream.buffer and therefore we can't use io.TextIOWrapper. Instead we use codecs
        return codecs.getreader(encoding)(stream)


def encode_output_stream(stream, encoding):
    if encoding is None:
        return stream
    if PY3:
        try:
            return io.TextIOWrapper(stream.buffer, encoding=encoding)
        except AttributeError:
            # BytesIO doesn't have "buffer"
            return io.TextIOWrapper(stream, encoding=encoding)
    else:
        return codecs.getwriter(encoding)(stream)


def remove_utf8_bom(line, assumed_source_encoding):
    if assumed_source_encoding == 'latin-1' and len(line) >= 3 and line[:3] == '\xef\xbb\xbf':
        return line[3:]
    # TODO consider replacing "utf-8" with "utf-8-sig" to automatically remove BOM, see https://stackoverflow.com/a/44573867/2898283
    if assumed_source_encoding == 'utf-8' and len(line) >= 1 and line[0] == u'\ufeff':
        return line[1:]
    return line


def str_py2(obj):
    return obj if isinstance(obj, basestring) else str(obj)


def str_py3(obj):
    return obj if isinstance(obj, str) else str(obj)


polymorphic_str = str_py3 if PY3 else str_py2



def try_read_index(index_path):
    lines = []
    try:
        with open(index_path) as f:
            lines = f.readlines()
    except Exception:
        return []
    result = list()
    for line in lines:
        line = line.rstrip('\r\n')
        record = line.split('\t')
        result.append(record)
    return result


def get_index_record(index_path, key):
    records = try_read_index(index_path)
    for record in records:
        if len(record) and record[0] == key:
            return record
    return None


def find_table_path(table_id):
    candidate_path = os.path.expanduser(table_id)
    if os.path.exists(candidate_path):
        return candidate_path
    name_record = get_index_record(table_names_settings_path, table_id)
    if name_record is not None and len(name_record) > 1 and os.path.exists(name_record[1]):
        return name_record[1]
    return None


def make_inconsistent_num_fields_warning(table_name, inconsistent_records_info):
    assert len(inconsistent_records_info) > 1
    inconsistent_records_info = inconsistent_records_info.items()
    inconsistent_records_info = sorted(inconsistent_records_info, key=lambda v: v[1])
    num_fields_1, record_num_1 = inconsistent_records_info[0]
    num_fields_2, record_num_2 = inconsistent_records_info[1]
    warn_msg = 'Number of fields in "{}" table is not consistent: '.format(table_name)
    warn_msg += 'e.g. record {} -> {} fields, record {} -> {} fields'.format(record_num_1, num_fields_1, record_num_2, num_fields_2)
    return warn_msg



class CSVWriter:
    def __init__(self, stream, close_stream_on_finish, encoding, delim, policy, line_separator='\n'):
        assert encoding in ['utf-8', 'latin-1', None]
        self.stream = encode_output_stream(stream, encoding)
        self.line_separator = line_separator
        self.delim = delim
        self.sub_array_delim = '|' if delim != '|' else ';'
        self.close_stream_on_finish = close_stream_on_finish
        if policy == 'simple':
            self.polymorphic_join = self.simple_join
        elif policy == 'quoted':
            self.polymorphic_join = self.quoted_join
        elif policy == 'quoted_rfc':
            self.polymorphic_join = self.rfc_quoted_join
        elif policy == 'monocolumn':
            self.polymorphic_join = self.mono_join
        elif policy == 'whitespace':
            self.polymorphic_join = self.simple_join
        else:
            raise RuntimeError('unknown output csv policy')

        self.none_in_output = False
        self.delim_in_simple_output = False


    def quoted_join(self, fields):
        return self.delim.join([csv_utils.quote_field(f, self.delim) for f in fields])


    def rfc_quoted_join(self, fields):
        return self.delim.join([csv_utils.rfc_quote_field(f, self.delim) for f in fields])


    def mono_join(self, fields):
        if len(fields) > 1:
            raise RbqlIOHandlingError('Unable to use "Monocolumn" output format: some records have more than one field')
        return fields[0]


    def simple_join(self, fields):
        res = self.delim.join([f for f in fields])
        num_fields = res.count(self.delim)
        if num_fields + 1 != len(fields):
            self.delim_in_simple_output = True
        return res


    def normalize_fields(self, fields):
        for i in polymorphic_xrange(len(fields)):
            if fields[i] is None:
                fields[i] = ''
                self.none_in_output = True
            elif isinstance(fields[i], list):
                self.normalize_fields(fields[i])
                fields[i] = self.sub_array_delim.join(fields[i])
            else:
                fields[i] = polymorphic_str(fields[i])


    def write(self, fields):
        self.normalize_fields(fields)
        self.stream.write(self.polymorphic_join(fields))
        self.stream.write(self.line_separator)


    def _write_all(self, table):
        for record in table:
            self.write(record)
        self.finish()


    def finish(self):
        try:
            if self.close_stream_on_finish:
                self.stream.close()
            else:
                self.stream.flush()
        except Exception:
            pass


    def get_warnings(self):
        result = list()
        if self.none_in_output:
            result.append('None values in output were replaced by empty strings')
        if self.delim_in_simple_output:
            result.append('Some output fields contain separator')
        return result


def python_string_escape_column_name(column_name, quote_char):
    assert quote_char in ['"', "'"]
    column_name = column_name.replace('\\', '\\\\')
    if quote_char == '"':
        return column_name.replace('"', '\\"')
    return column_name.replace("'", "\\'")


def parse_dictionary_variables(query, prefix, header_columns_names, dst_variables_map):
    # The purpose of this algorithm is to minimize number of variables in varibale_map to improve performance, ideally it should be only variables from the query
    # TODO implement algorithm for honest python f-string parsing
    assert prefix in ['a', 'b']
    if re.search(r'(?:^|[^_a-zA-Z0-9]){}\['.format(prefix), query) is None:
        return
    for i in polymorphic_xrange(len(header_columns_names)):
        column_name = header_columns_names[i]
        continuous_name_segments = re.findall('[-a-zA-Z0-9_:;+=!.,()%^#@&* ]+', column_name)
        add_column_name = True
        for continuous_segment in continuous_name_segments:
            if query.find(continuous_segment) == -1:
                add_column_name = False
                break
        if add_column_name:
            dst_variables_map['{}["{}"]'.format(prefix, python_string_escape_column_name(column_name, '"'))] = engine.VariableInfo(initialize=True, index=i)
            dst_variables_map["{}['{}']".format(prefix, python_string_escape_column_name(column_name, "'"))] = engine.VariableInfo(initialize=False, index=i)


def parse_attribute_variables(query, prefix, header_columns_names, dst_variables_map):
    # The purpose of this algorithm is to minimize number of variables in varibale_map to improve performance, ideally it should be only variables from the query

    # TODO ideally we should either:
    # * not search inside string literals (excluding brackets in f-strings) OR
    # * check if column_name is not among reserved python keywords like "None", "if", "else", etc

    assert prefix in ['a', 'b']
    header_columns_names = {v: i for i, v in enumerate(header_columns_names)}
    rgx = r'(?:^|[^_a-zA-Z0-9]){}\.([_a-zA-Z][_a-zA-Z0-9]*)'.format(prefix)
    matches = list(re.finditer(rgx, query))
    column_names = list(set([m.group(1) for m in matches]))
    for column_name in column_names:
        zero_based_idx = header_columns_names.get(column_name)
        if zero_based_idx is not None:
            dst_variables_map['{}.{}'.format(prefix, column_name)] = engine.VariableInfo(initialize=True, index=zero_based_idx)
        else:
            raise RbqlParsingError('Unable to find column "{}" in {} CSV header line'.format(column_name, {'a': 'input', 'b': 'join'}[prefix]))



class CSVRecordIterator:
    def __init__(self, stream, close_stream_on_finish, encoding, delim, policy, table_name='input', variable_prefix='a', chunk_size=1024, line_mode=False):
        assert encoding in ['utf-8', 'latin-1', None]
        self.encoding = encoding
        self.stream = encode_input_stream(stream, encoding)
        self.close_stream_on_finish = close_stream_on_finish
        self.delim = delim
        self.policy = 'quoted' if policy == 'quoted_rfc' else policy
        self.table_name = table_name
        self.variable_prefix = variable_prefix

        self.buffer = ''
        self.detected_line_separator = '\n'
        self.exhausted = False
        self.NR = 0
        self.chunk_size = chunk_size
        self.fields_info = dict()

        self.utf8_bom_removed = False
        self.first_defective_line = None # TODO use line # instead of record # when "\n" in fields parsing is implemented
        self.polymorphic_get_row = self.get_row_rfc if policy == 'quoted_rfc' else self.get_row_simple

        if not line_mode:
            self.header_record = None
            self.header_record_emitted = False
            self.header_record = self.get_record()
            assert not self.header_record_emitted


    def get_variables_map(self, query):
        variable_map = dict()
        engine.parse_basic_variables(query, self.variable_prefix, variable_map)
        engine.parse_array_variables(query, self.variable_prefix, variable_map)
        if self.header_record is not None:
            parse_attribute_variables(query, self.variable_prefix, self.header_record, variable_map)
            parse_dictionary_variables(query, self.variable_prefix, self.header_record, variable_map)
        return variable_map


    def finish(self):
        if self.close_stream_on_finish:
            self.stream.close()


    def _get_row_from_buffer(self):
        str_before, separator, str_after = csv_utils.extract_line_from_data(self.buffer)
        if separator is None:
            return None
        if separator == '\r' and str_after == '':
            one_more = self.stream.read(1)
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
            chunk = self.stream.read(self.chunk_size)
            if not chunk:
                self.exhausted = True
                break
            chunks.append(chunk)
            if csv_utils.newline_rgx.search(chunk) is not None:
                break
        self.buffer += ''.join(chunks)


    def get_row_simple(self):
        try:
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
        except UnicodeDecodeError:
            raise RbqlIOHandlingError('Unable to decode input table as UTF-8. Use binary (latin-1) encoding instead')

    
    def get_row_rfc(self):
        first_row = self.get_row_simple()
        if first_row is None:
            return None
        if first_row.count('"') % 2 == 0:
            return first_row
        rows_buffer = [first_row]
        while True:
            row = self.get_row_simple()
            if row is None:
                return '\n'.join(rows_buffer)
            rows_buffer.append(row)
            if row.count('"') % 2 == 1:
                return '\n'.join(rows_buffer)


    def get_record(self):
        if not self.header_record_emitted and self.header_record is not None:
            self.header_record_emitted = True
            return self.header_record
        line = self.polymorphic_get_row()
        if line is None:
            return None
        if self.NR == 0:
            clean_line = remove_utf8_bom(line, self.encoding)
            if clean_line != line:
                line = clean_line
                self.utf8_bom_removed = True
        self.NR += 1
        record, warning = csv_utils.smart_split(line, self.delim, self.policy, preserve_quotes_and_whitespaces=False)
        if warning and self.first_defective_line is None:
            self.first_defective_line = self.NR
        num_fields = len(record)
        if num_fields not in self.fields_info:
            self.fields_info[num_fields] = self.NR
        return record


    def _get_all_rows(self):
        result = []
        while True:
            row = self.polymorphic_get_row()
            if row is None:
                break
            result.append(row)
        return result


    def get_all_records(self, num_rows=None):
        result = []
        while True:
            record = self.get_record()
            if record is None:
                break
            result.append(record)
            if num_rows is not None and len(result) >= num_rows:
                break
        self.finish()
        return result


    def get_warnings(self):
        result = list()
        if self.utf8_bom_removed:
            result.append('UTF-8 Byte Order Mark (BOM) was found and skipped in {} table'.format(self.table_name))
        if self.first_defective_line is not None:
            result.append('Defective double quote escaping in {} table. E.g. at line {}'.format(self.table_name, self.first_defective_line))
        if len(self.fields_info) > 1:
            result.append(make_inconsistent_num_fields_warning(self.table_name, self.fields_info))
        return result


class FileSystemCSVRegistry:
    def __init__(self, delim, policy, encoding):
        self.delim = delim
        self.policy = policy
        self.encoding = encoding
        self.record_iterator = None

    def get_iterator_by_table_id(self, table_id):
        table_path = find_table_path(table_id)
        if table_path is None:
            raise RbqlIOHandlingError('Unable to find join table "{}"'.format(table_id))
        self.record_iterator = CSVRecordIterator(open(table_path, 'rb'), True, self.encoding, self.delim, self.policy, table_name=table_id, variable_prefix='b')
        return self.record_iterator

    def finish(self):
        if self.record_iterator is not None:
            self.record_iterator.finish()


def csv_run(user_query, input_path, input_delim, input_policy, output_path, output_delim, output_policy, csv_encoding, user_init_code=''):
    output_stream, close_output_on_finish = (None, False)
    input_stream, close_input_on_finish = (None, False)
    try:
        output_stream, close_output_on_finish = (sys.stdout, False) if output_path is None else (open(output_path, 'wb'), True)
        input_stream, close_input_on_finish = (sys.stdin, False) if input_path is None else (open(input_path, 'rb'), True)

        if input_delim == '"' and input_policy == 'quoted':
            raise RbqlIOHandlingError('Double quote delimiter is incompatible with "quoted" policy')
        if input_delim != ' ' and input_policy == 'whitespace':
            raise RbqlIOHandlingError('Only whitespace " " delim is supported with "whitespace" policy')

        if not is_ascii(user_query) and csv_encoding == 'latin-1':
            raise RbqlIOHandlingError('To use non-ascii characters in query enable UTF-8 encoding instead of latin-1/binary')

        if (not is_ascii(input_delim) or not is_ascii(output_delim)) and csv_encoding == 'latin-1':
            raise RbqlIOHandlingError('To use non-ascii separators enable UTF-8 encoding instead of latin-1/binary')

        default_init_source_path = os.path.join(os.path.expanduser('~'), '.rbql_init_source.py')
        if user_init_code == '' and os.path.exists(default_init_source_path):
            user_init_code = read_user_init_code(default_init_source_path)

        join_tables_registry = FileSystemCSVRegistry(input_delim, input_policy, csv_encoding)
        input_iterator = CSVRecordIterator(input_stream, close_input_on_finish, csv_encoding, input_delim, input_policy)
        output_writer = CSVWriter(output_stream, close_output_on_finish, csv_encoding, output_delim, output_policy)
        if debug_mode:
            engine.set_debug_mode()
        error_info, warnings = engine.generic_run(user_query, input_iterator, output_writer, join_tables_registry, user_init_code)
        join_tables_registry.finish()
        return (error_info, warnings)
    except Exception as e:
        if debug_mode:
            raise
        error_info = engine.exception_to_error_info(e)
        return (error_info, [])
    finally:
        if close_input_on_finish:
            input_stream.close()
        if close_output_on_finish:
            output_stream.close()


def set_debug_mode():
    global debug_mode
    debug_mode = True
