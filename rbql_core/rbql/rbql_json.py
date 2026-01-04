import json
import sys
import os
import io
import re

from . import rbql_engine
from . import csv_utils
from . import rbql_csv

debug_mode = False

def set_debug_mode():
    global debug_mode
    debug_mode = True

class JsonWriter(rbql_engine.RBQLOutputWriter):
    def __init__(self, stream, close_stream_on_finish, encoding, line_separator='\n'):
        assert encoding in ['utf-8', 'latin-1', None]
        self.stream = rbql_csv.encode_output_stream(stream, encoding)
        self.line_separator = line_separator
        self.close_stream_on_finish = close_stream_on_finish
        self.broken_pipe = False

    def write(self, fields):
        obj_to_write = fields
        if len(fields) == 1:
            obj_to_write = fields[0]

        try:
            json_str = json.dumps(obj_to_write, ensure_ascii=False, default=str)
        except TypeError as e:
            raise rbql_engine.RbqlIOHandlingError('Error serializing object to JSON: {}'.format(e))

        try:
            self.stream.write(json_str)
            self.stream.write(self.line_separator)
            return True
        except BrokenPipeError as exc:
            self.broken_pipe = True
            return False

    def finish(self):
        if self.broken_pipe:
            return
        if self.close_stream_on_finish:
            self.stream.close()
        else:
            try:
                self.stream.flush()
            except BrokenPipeError as exc:
                try:
                    sys.stdout.close()
                except Exception:
                    pass

    def get_warnings(self):
        return []


class JsonLinesRecordIterator(rbql_engine.RBQLInputIterator):
    def __init__(self, stream, encoding, table_name='input', variable_prefix='a', chunk_size=1024):
        assert encoding in ['utf-8', 'latin-1', None]
        self.encoding = encoding
        self.stream = rbql_csv.encode_input_stream(stream, encoding)
        self.table_name = table_name
        self.variable_prefix = variable_prefix

        self.buffer = ''
        self.exhausted = False
        self.NR = 0 # Record number
        self.NL = 0 # Line number
        self.chunk_size = chunk_size
        self.utf8_bom_removed = False

    def get_variables_map(self, query_text):
        return {
            self.variable_prefix + '1': rbql_engine.VariableInfo(initialize=True, index=0),
            self.variable_prefix: rbql_engine.VariableInfo(initialize=True, index=0)
        } 

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

    def get_row(self):
        try:
            row = self._get_row_from_buffer()
            if row is None:
                self._read_until_found()
                row = self._get_row_from_buffer()
                if row is None:
                    assert self.exhausted
                    if not len(self.buffer):
                        return None
                    row = self.buffer
                    self.buffer = ''
            self.NL += 1
            if self.NL == 1:
                clean_line = rbql_csv.remove_utf8_bom(row, self.encoding)
                if clean_line != row:
                    row = clean_line
                    self.utf8_bom_removed = True
            return row
        except UnicodeDecodeError:
            raise rbql_engine.RbqlIOHandlingError('Unable to decode input table as UTF-8. Use binary (latin-1) encoding instead')

    def get_record(self):
        while True:
            line = self.get_row()
            if line is None:
                return None
            line = line.strip()
            if not line:
                continue
            try:
                json_obj = json.loads(line)
                self.NR += 1
                return [json_obj]
            except json.JSONDecodeError as e:
                raise rbql_engine.RbqlIOHandlingError('Error decoding JSON in {} table at record {}, line {}: {}'.format(self.table_name, self.NR + 1, self.NL, str(e)))

    def get_warnings(self):
        result = []
        if self.utf8_bom_removed:
            result.append('UTF-8 Byte Order Mark (BOM) was found and skipped in {} table'.format(self.table_name))
        return result


# TODO we might want the output to optionally be CSV too. 
def query_json(query_text, input_path, output_path, output_warnings, user_init_code=''):
    output_stream, close_output_on_finish = (None, False)
    input_stream, close_input_on_finish = (None, False)
    join_tables_registry = None
    try:
        output_stream, close_output_on_finish = (sys.stdout, False) if output_path is None else (open(output_path, 'wb'), True)
        input_stream, close_input_on_finish = (sys.stdin, False) if input_path is None else (open(input_path, 'rb'), True)

        default_init_source_path = os.path.join(os.path.expanduser('~'), '.rbql_init_source.py')
        if user_init_code == '' and os.path.exists(default_init_source_path):
            user_init_code = rbql_csv.read_user_init_code(default_init_source_path)
        input_iterator = JsonLinesRecordIterator(input_stream, 'utf-8', table_name='input', variable_prefix='a')
        output_writer = JsonWriter(output_stream, close_output_on_finish, 'utf-8')
        if debug_mode:
            rbql_engine.set_debug_mode()
        rbql_engine.query(query_text, input_iterator, output_writer, output_warnings, join_tables_registry, user_init_code)
    finally:
        if close_input_on_finish:
            input_stream.close()
        if close_output_on_finish:
            output_stream.close()

