# -*- coding: utf-8 -*-
from __future__ import unicode_literals
from __future__ import print_function

import sys
import os
import codecs
import io
import re
from errno import EPIPE

from . import rbql_engine
from . import csv_utils


PY3 = sys.version_info[0] == 3

default_csv_encoding = 'utf-8'

user_home_dir = os.path.expanduser('~')
table_names_settings_path = os.path.join(user_home_dir, '.rbql_table_names')


# TODO performance improvement: replace smart_split() with polymorphic_split()


polymorphic_xrange = range if PY3 else xrange


debug_mode = False


ansi_reset_color_code = '\u001b[0m'


try:
    broken_pipe_exception = BrokenPipeError
except NameError: # Python 2
    broken_pipe_exception = IOError


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


def init_ansi_terminal_colors():
    result = [ansi_reset_color_code]
    foreground_codes = list(range(31, 37 + 1))
    background_codes = list(range(41, 47 + 1))
    for fc in foreground_codes:
        result.append('\u001b[{}m'.format(fc))
    for fc in foreground_codes:
        for bc in background_codes:
            if fc % 10 == bc % 10:
                continue
            if fc % 10 in [2, 6] and bc % 10 in [2, 6]: # Skipping green - cyan pair cause they might have low contrast
                continue
            result.append('\u001b[{};{}m'.format(fc, bc))
    return result



class CSVWriter:
    def __init__(self, stream, close_stream_on_finish, encoding, delim, policy, line_separator='\n', colorize_output=False):
        assert encoding in ['utf-8', 'latin-1', None]
        self.stream = encode_output_stream(stream, encoding)
        self.line_separator = line_separator
        self.delim = delim
        self.sub_array_delim = '|' if delim != '|' else ';'
        self.broken_pipe = False
        self.close_stream_on_finish = close_stream_on_finish
        self.polymorphic_preprocess = None
        self.polymorphic_join = self.join_by_delim 
        self.check_separators_after_join = False
        self.colors = None
        if policy == 'simple' or policy == 'whitespace':
            if colorize_output:
                self.polymorphic_preprocess = self.check_separators_in_fields_before_join
            else:
                self.check_separators_after_join = True
        elif policy == 'quoted':
            self.polymorphic_preprocess = self.quote_fields
        elif policy == 'quoted_rfc':
            self.polymorphic_preprocess = self.quote_fields_rfc
        elif policy == 'monocolumn':
            colorize_output = False
            self.polymorphic_preprocess = self.ensure_single_field
            self.polymorphic_join = self.monocolumn_join
        else:
            raise RuntimeError('unknown output csv policy')

        if colorize_output:
            self.colors = init_ansi_terminal_colors()

        self.none_in_output = False
        self.delim_in_simple_output = False


    def monocolumn_join(self, fields):
        return fields[0]


    def check_separators_in_fields_before_join(self, fields):
        if ''.join(fields).find(self.delim) != -1:
            self.delim_in_simple_output = True


    def check_separator_in_fields_after_join(self, output_line, num_fields_expected):
        num_fields_calculated = output_line.count(self.delim) + 1
        if num_fields_calculated != num_fields_expected:
            self.delim_in_simple_output = True


    def join_by_delim(self, fields):
        return self.delim.join(fields)


    def write(self, fields):
        self.normalize_fields(fields)

        if self.polymorphic_preprocess is not None:
            self.polymorphic_preprocess(fields)

        if self.colors is not None:
            self.colorize_fields(fields)

        out_line = self.polymorphic_join(fields)

        if self.check_separators_after_join:
            self.check_separator_in_fields_after_join(out_line, len(fields))

        try:
            self.stream.write(out_line)
            if self.colors is not None:
                self.stream.write(ansi_reset_color_code)
            self.stream.write(self.line_separator)
            return True
        except broken_pipe_exception as exc:
            if broken_pipe_exception == IOError:
                if exc.errno != EPIPE:
                    raise
            self.broken_pipe = True
            return False


    def colorize_fields(self, fields):
        for i in polymorphic_xrange(len(fields)):
            fields[i] = self.colors[i % len(self.colors)] + fields[i]


    def quote_fields(self, fields):
        for i in polymorphic_xrange(len(fields)):
            fields[i] = csv_utils.quote_field(fields[i], self.delim)


    def quote_fields_rfc(self, fields):
        for i in polymorphic_xrange(len(fields)):
            fields[i] = csv_utils.rfc_quote_field(fields[i], self.delim)


    def ensure_single_field(self, fields):
        if len(fields) > 1:
            raise RbqlIOHandlingError('Unable to use "Monocolumn" output format: some records have more than one field')


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


    def _write_all(self, table):
        for record in table:
            self.write(record[:])
        self.finish()


    def finish(self):
        if self.broken_pipe:
            return
        if self.close_stream_on_finish:
            self.stream.close()
        else:
            try:
                self.stream.flush() # This flush still can throw if all flushes before were sucessfull! And the exceptions would be printed anyway, even if it was explicitly catched just couple of lines after.
                # Basically this fails if output is small and this is the first flush after the pipe was broken e.g. second flush if piped to head -n 1
                # Here head -n 1 finished after the first flush, and the final explict flush here just killing it
            except broken_pipe_exception as exc:
                if broken_pipe_exception == IOError:
                    if exc.errno != EPIPE:
                        raise
                # In order to avoid BrokenPipeError from being printed as a warning to stderr, we need to perform this magic below. See:
                # Explanation 1: https://stackoverflow.com/a/35761190/2898283
                # Explanation 2: https://bugs.python.org/issue11380
                try:
                    sys.stdout.close()
                except Exception:
                    pass


    def get_warnings(self):
        result = list()
        if self.none_in_output:
            result.append('None values in output were replaced by empty strings')
        if self.delim_in_simple_output:
            result.append('Some output fields contain separator')
        return result


class CSVRecordIterator:
    def __init__(self, stream, encoding, delim, policy, skip_headers=False, table_name='input', variable_prefix='a', chunk_size=1024, line_mode=False):
        assert encoding in ['utf-8', 'latin-1', None]
        self.encoding = encoding
        self.stream = encode_input_stream(stream, encoding)
        self.delim = delim
        self.policy = policy
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
            self.header_record_emitted = skip_headers
            self.header_record = self.get_record()


    def get_variables_map(self, query_text):
        variable_map = dict()
        rbql_engine.parse_basic_variables(query_text, self.variable_prefix, variable_map)
        rbql_engine.parse_array_variables(query_text, self.variable_prefix, variable_map)
        if self.header_record is not None:
            rbql_engine.parse_attribute_variables(query_text, self.variable_prefix, self.header_record, 'CSV header line', variable_map)
            rbql_engine.parse_dictionary_variables(query_text, self.variable_prefix, self.header_record, variable_map)
        return variable_map


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
        if warning:
            if self.first_defective_line is None:
                self.first_defective_line = self.NR
                if self.policy == 'quoted_rfc':
                    # TODO add line number when NL is supported
                    raise RbqlIOHandlingError('Inconsistent double quote escaping in {} table at record {}'.format(self.table_name, self.NR))
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
        return result


    def get_warnings(self):
        result = list()
        if self.utf8_bom_removed:
            result.append('UTF-8 Byte Order Mark (BOM) was found and skipped in {} table'.format(self.table_name))
        if self.first_defective_line is not None:
            result.append('Inconsistent double quote escaping in {} table. E.g. at line {}'.format(self.table_name, self.first_defective_line))
        if len(self.fields_info) > 1:
            result.append(make_inconsistent_num_fields_warning(self.table_name, self.fields_info))
        return result


class FileSystemCSVRegistry:
    def __init__(self, delim, policy, encoding, skip_headers):
        self.delim = delim
        self.policy = policy
        self.encoding = encoding
        self.record_iterator = None
        self.input_stream = None
        self.skip_headers = skip_headers
        self.table_path = None

    def get_iterator_by_table_id(self, table_id):
        self.table_path = find_table_path(table_id)
        if self.table_path is None:
            raise RbqlIOHandlingError('Unable to find join table "{}"'.format(table_id))
        self.input_stream = open(self.table_path, 'rb')
        self.record_iterator = CSVRecordIterator(self.input_stream, self.encoding, self.delim, self.policy, self.skip_headers, table_name=table_id, variable_prefix='b')
        return self.record_iterator

    def finish(self, output_warnings):
        if self.input_stream is not None:
            self.input_stream.close()
            if self.skip_headers:
                output_warnings.append('The first (header) record was also skipped in the JOIN file: {}'.format(os.path.basename(self.table_path))) # UT JSON CSV


def query_csv(query_text, input_path, input_delim, input_policy, output_path, output_delim, output_policy, csv_encoding, output_warnings, skip_headers=False, user_init_code='', colorize_output=False):
    output_stream, close_output_on_finish = (None, False)
    input_stream, close_input_on_finish = (None, False)
    join_tables_registry = None
    try:
        output_stream, close_output_on_finish = (sys.stdout, False) if output_path is None else (open(output_path, 'wb'), True)
        input_stream, close_input_on_finish = (sys.stdin, False) if input_path is None else (open(input_path, 'rb'), True)

        if input_delim == '"' and input_policy == 'quoted':
            raise RbqlIOHandlingError('Double quote delimiter is incompatible with "quoted" policy')
        if input_delim != ' ' and input_policy == 'whitespace':
            raise RbqlIOHandlingError('Only whitespace " " delim is supported with "whitespace" policy')

        if not is_ascii(query_text) and csv_encoding == 'latin-1':
            raise RbqlIOHandlingError('To use non-ascii characters in query enable UTF-8 encoding instead of latin-1/binary')

        if (not is_ascii(input_delim) or not is_ascii(output_delim)) and csv_encoding == 'latin-1':
            raise RbqlIOHandlingError('To use non-ascii separators enable UTF-8 encoding instead of latin-1/binary')

        default_init_source_path = os.path.join(os.path.expanduser('~'), '.rbql_init_source.py')
        if user_init_code == '' and os.path.exists(default_init_source_path):
            user_init_code = read_user_init_code(default_init_source_path)

        join_tables_registry = FileSystemCSVRegistry(input_delim, input_policy, csv_encoding, skip_headers)
        input_iterator = CSVRecordIterator(input_stream, csv_encoding, input_delim, input_policy, skip_headers)
        output_writer = CSVWriter(output_stream, close_output_on_finish, csv_encoding, output_delim, output_policy, colorize_output=colorize_output)
        if debug_mode:
            rbql_engine.set_debug_mode()
        rbql_engine.query(query_text, input_iterator, output_writer, output_warnings, join_tables_registry, user_init_code)
    finally:
        if close_input_on_finish:
            input_stream.close()
        if close_output_on_finish:
            output_stream.close()
        if join_tables_registry:
            join_tables_registry.finish(output_warnings)


def set_debug_mode():
    global debug_mode
    debug_mode = True
