#!/usr/bin/env python
# -*- coding: utf-8 -*-
from __future__ import unicode_literals
from __future__ import print_function

import sys
import os
import re
import importlib
import codecs
import io
import tempfile
import random
import shutil
import time

##########################################################################
#
# RBQL: RainBow Query Language
# Authors: Dmitry Ignatovich, ...
#
#
##########################################################################

# This module must be both python2 and python3 compatible


__version__ = '0.2.0'


GROUP_BY = 'GROUP BY'
UPDATE = 'UPDATE'
SELECT = 'SELECT'
JOIN = 'JOIN'
INNER_JOIN = 'INNER JOIN'
LEFT_JOIN = 'LEFT JOIN'
STRICT_LEFT_JOIN = 'STRICT LEFT JOIN'
ORDER_BY = 'ORDER BY'
WHERE = 'WHERE'
LIMIT = 'LIMIT'


default_csv_encoding = 'latin-1'

PY3 = sys.version_info[0] == 3

rbql_home_dir = os.path.dirname(os.path.abspath(__file__))
user_home_dir = os.path.expanduser('~')
table_names_settings_path = os.path.join(user_home_dir, '.rbql_table_names')
table_index_path = os.path.join(user_home_dir, '.rbql_table_index')

py_script_body = codecs.open(os.path.join(rbql_home_dir, 'template.py.raw'), encoding='utf-8').read()


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


def normalize_delim(delim):
    if delim == 'TAB':
        return '\t'
    if delim == r'\t':
        return '\t'
    return delim


def get_encoded_stdin(encoding_name):
    if PY3:
        return io.TextIOWrapper(sys.stdin.buffer, encoding=encoding_name)
    else:
        return codecs.getreader(encoding_name)(sys.stdin)


def get_encoded_stdout(encoding_name):
    if PY3:
        return io.TextIOWrapper(sys.stdout.buffer, encoding=encoding_name)
    else:
        return codecs.getwriter(encoding_name)(sys.stdout)


def xrange6(x):
    if PY3:
        return range(x)
    return xrange(x)


def rbql_meta_format(template_src, meta_params):
    for key, value in meta_params.items():
        # TODO make special replace for multiple statements, like in update, it should be indent-aware
        template_src_upd = template_src.replace(key, value)
        assert template_src_upd != template_src
        template_src = template_src_upd
    return template_src


def remove_if_possible(file_path):
    try:
        os.remove(file_path)
    except Exception:
        pass


class RBParsingError(Exception):
    pass


def strip_py_comments(cline):
    cline = cline.strip()
    if cline.startswith('#'):
        return ''
    return cline


def escape_string_literal(src):
    result = src.replace('\\', '\\\\')
    result = result.replace('\t', '\\t')
    result = result.replace("'", r"\'")
    return result


def parse_join_expression(src):
    match = re.match(r'(?i)^ *([^ ]+) +on +([ab][0-9]+) *== *([ab][0-9]+) *$', src)
    if match is None:
        raise RBParsingError('Incorrect join syntax. Must be: "<JOIN> /path/to/B/table on a<i> == b<j>"')
    table_id = match.group(1)
    avar = match.group(2)
    bvar = match.group(3)
    if avar[0] == 'b':
        avar, bvar = bvar, avar
    if avar[0] != 'a' or bvar[0] != 'b':
        raise RBParsingError('Incorrect join syntax. Must be: "<JOIN> /path/to/B/table on a<i> == b<j>"')
    lhs_join_var = 'safe_get(afields, {})'.format(int(avar[1:]))
    rhs_join_var = 'safe_get(bfields, {})'.format(int(bvar[1:]))
    return (table_id, lhs_join_var, rhs_join_var)


def find_table_path(table_id):
    candidate_path = os.path.expanduser(table_id)
    if os.path.exists(candidate_path):
        return candidate_path
    name_record = get_index_record(table_names_settings_path, table_id)
    if name_record is not None and len(name_record) > 1 and os.path.exists(name_record[1]):
        return name_record[1]
    return None


def replace_column_vars(rbql_expression):
    translated = re.sub('(?:^|(?<=[^_a-zA-Z0-9]))([ab])([1-9][0-9]*)(?:$|(?=[^_a-zA-Z0-9]))', r'safe_get(\1fields, \2)', rbql_expression)
    return translated


def replace_star_count(aggregate_expression):
    return re.sub(r'(^|(?<=,)) *COUNT\( *\* *\) *($|(?=,))', ' COUNT(1)', aggregate_expression).lstrip(' ')


def replace_star_vars_py(rbql_expression):
    rbql_expression = re.sub(r'(?:^|,) *\* *(?=, *\* *($|,))', '] + star_fields + [', rbql_expression)
    rbql_expression = re.sub(r'(?:^|,) *\* *(?:$|,)', '] + star_fields + [', rbql_expression)
    return rbql_expression


def translate_update_expression(update_expression, indent):
    translated = re.sub('(?:^|,) *a([1-9][0-9]*) *=(?=[^=])', '\nsafe_set(afields, \\1,', update_expression)
    update_statements = translated.split('\n')
    update_statements = [s.strip() for s in update_statements]
    if len(update_statements) < 2 or update_statements[0] != '':
        raise RBParsingError('Unable to parse "UPDATE" expression')
    update_statements = update_statements[1:]
    update_statements = ['{})'.format(s) for s in update_statements]
    for i in range(1, len(update_statements)):
        update_statements[i] = indent + update_statements[i]
    translated = '\n'.join(update_statements)
    translated = replace_column_vars(translated)
    return translated


def translate_select_expression_py(select_expression):
    translated = replace_star_count(select_expression)
    translated = replace_column_vars(translated)
    translated = replace_star_vars_py(translated)
    translated = translated.strip()
    if not len(translated):
        raise RBParsingError('"SELECT" expression is empty')
    return '[{}]'.format(translated)


def separate_string_literals_py(rbql_expression):
    string_literals_regex = r'''(\"\"\"|\'\'\'|\"|\')((?<!\\)(\\\\)*\\\1|.)*?\1'''
    return do_separate_string_literals(rbql_expression, string_literals_regex)


def do_separate_string_literals(rbql_expression, string_literals_regex):
    # The regex is improved expression from here: https://stackoverflow.com/a/14366904/2898283
    matches = list(re.finditer(string_literals_regex, rbql_expression))
    string_literals = list()
    format_parts = list()
    idx_before = 0
    for m in matches:
        literal_id = len(string_literals)
        string_literals.append(m.group(0))
        format_parts.append(rbql_expression[idx_before:m.start()])
        format_parts.append('###RBQL_STRING_LITERAL###{}'.format(literal_id))
        idx_before = m.end()
    format_parts.append(rbql_expression[idx_before:])
    format_expression = ''.join(format_parts)
    format_expression = format_expression.replace('\t', ' ')
    return (format_expression, string_literals)


def combine_string_literals(backend_expression, string_literals):
    for i in range(len(string_literals)):
        backend_expression = backend_expression.replace('###RBQL_STRING_LITERAL###{}'.format(i), string_literals[i])
    return backend_expression


def locate_statements(rbql_expression):
    statement_groups = list()
    statement_groups.append([STRICT_LEFT_JOIN, LEFT_JOIN, INNER_JOIN, JOIN])
    statement_groups.append([SELECT])
    statement_groups.append([ORDER_BY])
    statement_groups.append([WHERE])
    statement_groups.append([UPDATE])
    statement_groups.append([GROUP_BY])
    statement_groups.append([LIMIT])

    result = list()
    for st_group in statement_groups:
        for statement in st_group:
            rgxp = r'(?i)(?:^| ){} '.format(statement.replace(' ', ' *'))
            matches = list(re.finditer(rgxp, rbql_expression))
            if not len(matches):
                continue
            if len(matches) > 1:
                raise RBParsingError('More than one "{}" statements found'.format(statement))
            assert len(matches) == 1
            match = matches[0]
            result.append((match.start(), match.end(), statement))
            break # There must be only one statement maximum in each group
    return sorted(result)


def separate_actions(rbql_expression):
    # TODO add more checks: 
    # make sure all rbql_expression was separated and SELECT or UPDATE is at the beginning
    rbql_expression = rbql_expression.strip(' ')
    ordered_statements = locate_statements(rbql_expression)
    result = dict()
    for i in range(len(ordered_statements)):
        statement_start = ordered_statements[i][0]
        span_start = ordered_statements[i][1]
        statement = ordered_statements[i][2]
        span_end = ordered_statements[i + 1][0] if i + 1 < len(ordered_statements) else len(rbql_expression)
        assert statement_start < span_start
        assert span_start <= span_end
        span = rbql_expression[span_start:span_end]

        statement_params = dict()

        if statement in [STRICT_LEFT_JOIN, LEFT_JOIN, INNER_JOIN, JOIN]:
            statement_params['join_subtype'] = statement
            statement = JOIN

        if statement == UPDATE:
            if statement_start != 0:
                raise RBParsingError('UPDATE keyword must be at the beginning of the query')
            span = re.sub('(?i)^ *SET ', '', span)

        if statement == ORDER_BY:
            span = re.sub('(?i) ASC *$', '', span)
            new_span = re.sub('(?i) DESC *$', '', span)
            if new_span != span:
                span = new_span
                statement_params['reverse'] = True
            else:
                statement_params['reverse'] = False

        if statement == SELECT:
            if statement_start != 0:
                raise RBParsingError('SELECT keyword must be at the beginning of the query')
            match = re.match('(?i)^ *TOP *([0-9]+) ', span)
            if match is not None:
                statement_params['top'] = int(match.group(1))
                span = span[match.end():]
            match = re.match('(?i)^ *DISTINCT *(COUNT)? ', span)
            if match is not None:
                statement_params['distinct'] = True
                if match.group(1) is not None:
                    statement_params['distinct_count'] = True
                span = span[match.end():]

        statement_params['text'] = span.strip()
        result[statement] = statement_params
    if SELECT not in result and UPDATE not in result:
        raise RBParsingError('Query must contain either SELECT or UPDATE statement')
    assert (SELECT in result) != (UPDATE in result)
    return result


def find_top(rb_actions):
    if LIMIT in rb_actions:
        try:
            return int(rb_actions[LIMIT]['text'])
        except ValueError:
            raise RBParsingError('LIMIT keyword must be followed by an integer')
    return rb_actions[SELECT].get('top', None)


def parse_to_py(rbql_lines, py_dst, input_delim, input_policy, out_delim, out_policy, csv_encoding, import_modules):
    if not py_dst.endswith('.py'):
        raise RBParsingError('python module file must have ".py" extension')

    if input_delim == '"' and input_policy == 'quoted':
        raise RBParsingError('Double quote delimiter is incompatible with "quoted" policy')

    rbql_lines = [strip_py_comments(l) for l in rbql_lines]
    rbql_lines = [l for l in rbql_lines if len(l)]
    full_rbql_expression = ' '.join(rbql_lines)
    format_expression, string_literals = separate_string_literals_py(full_rbql_expression)
    rb_actions = separate_actions(format_expression)

    import_expression = ''
    if import_modules is not None:
        for mdl in import_modules:
            import_expression += 'import {}\n'.format(mdl)

    py_meta_params = dict()
    py_meta_params['__RBQLMP__import_expression'] = import_expression
    py_meta_params['__RBQLMP__input_delim'] = escape_string_literal(input_delim)
    py_meta_params['__RBQLMP__input_policy'] = input_policy
    py_meta_params['__RBQLMP__csv_encoding'] = csv_encoding
    py_meta_params['__RBQLMP__output_delim'] = escape_string_literal(out_delim)
    py_meta_params['__RBQLMP__output_policy'] = out_policy

    if ORDER_BY in rb_actions and UPDATE in rb_actions:
        raise RBParsingError('"ORDER BY" is not allowed in "UPDATE" queries')

    if GROUP_BY in rb_actions:
        if ORDER_BY in rb_actions or UPDATE in rb_actions:
            raise RBParsingError('"ORDER BY" and "UPDATE" are not allowed in aggregate queries')
        # TODO use js approach based on extract_column_vars function. Init missing fields with None using safe_get() for compatibility with js version
        aggregation_key_expression = replace_column_vars(rb_actions[GROUP_BY]['text'])
        py_meta_params['__RBQLMP__aggregation_key_expression'] = '[{}]'.format(combine_string_literals(aggregation_key_expression, string_literals))
    else:
        py_meta_params['__RBQLMP__aggregation_key_expression'] = 'None'

    if JOIN in rb_actions:
        rhs_table_id, lhs_join_var, rhs_join_var = parse_join_expression(rb_actions[JOIN]['text'])
        rhs_table_path = find_table_path(rhs_table_id)
        if rhs_table_path is None:
            raise RBParsingError('Unable to find join B table: "{}"'.format(rhs_table_id))

        join_delim, join_policy = input_delim, input_policy
        join_format_record = get_index_record(table_index_path, rhs_table_path)
        if join_format_record is not None and len(join_format_record) >= 3:
            join_delim = normalize_delim(join_format_record[1])
            join_policy = join_format_record[2]

        py_meta_params['__RBQLMP__join_operation'] = rb_actions[JOIN]['join_subtype']
        py_meta_params['__RBQLMP__rhs_table_path'] = escape_string_literal(rhs_table_path)
        py_meta_params['__RBQLMP__lhs_join_var'] = lhs_join_var
        py_meta_params['__RBQLMP__rhs_join_var'] = rhs_join_var
        py_meta_params['__RBQLMP__join_delim'] = escape_string_literal(join_delim)
        py_meta_params['__RBQLMP__join_policy'] = join_policy
    else:
        py_meta_params['__RBQLMP__join_operation'] = 'VOID'
        py_meta_params['__RBQLMP__rhs_table_path'] = ''
        py_meta_params['__RBQLMP__lhs_join_var'] = 'None'
        py_meta_params['__RBQLMP__rhs_join_var'] = 'None'
        py_meta_params['__RBQLMP__join_delim'] = ''
        py_meta_params['__RBQLMP__join_policy'] = ''

    if WHERE in rb_actions:
        where_expression = replace_column_vars(rb_actions[WHERE]['text'])
        py_meta_params['__RBQLMP__where_expression'] = combine_string_literals(where_expression, string_literals)
    else:
        py_meta_params['__RBQLMP__where_expression'] = 'True'

    if UPDATE in rb_actions:
        update_expression = translate_update_expression(rb_actions[UPDATE]['text'], ' ' * 8)
        py_meta_params['__RBQLMP__writer_type'] = 'simple'
        py_meta_params['__RBQLMP__select_expression'] = 'None'
        py_meta_params['__RBQLMP__update_statements'] = combine_string_literals(update_expression, string_literals)
        py_meta_params['__RBQLMP__is_select_query'] = 'False'
        py_meta_params['__RBQLMP__top_count'] = 'None'

    if SELECT in rb_actions:
        top_count = find_top(rb_actions)
        py_meta_params['__RBQLMP__top_count'] = str(top_count) if top_count is not None else 'None'
        if 'distinct_count' in rb_actions[SELECT]:
            py_meta_params['__RBQLMP__writer_type'] = 'uniq_count'
        elif 'distinct' in rb_actions[SELECT]:
            py_meta_params['__RBQLMP__writer_type'] = 'uniq'
        else:
            py_meta_params['__RBQLMP__writer_type'] = 'simple'
        select_expression = translate_select_expression_py(rb_actions[SELECT]['text'])
        py_meta_params['__RBQLMP__select_expression'] = combine_string_literals(select_expression, string_literals)
        py_meta_params['__RBQLMP__update_statements'] = 'pass'
        py_meta_params['__RBQLMP__is_select_query'] = 'True'

    if ORDER_BY in rb_actions:
        order_expression = replace_column_vars(rb_actions[ORDER_BY]['text'])
        py_meta_params['__RBQLMP__sort_key_expression'] = combine_string_literals(order_expression, string_literals)
        py_meta_params['__RBQLMP__reverse_flag'] = 'True' if rb_actions[ORDER_BY]['reverse'] else 'False'
        py_meta_params['__RBQLMP__sort_flag'] = 'True'
    else:
        py_meta_params['__RBQLMP__sort_key_expression'] = 'None'
        py_meta_params['__RBQLMP__reverse_flag'] = 'False'
        py_meta_params['__RBQLMP__sort_flag'] = 'False'

    with codecs.open(py_dst, 'w', encoding='utf-8') as dst:
        dst.write(rbql_meta_format(py_script_body, py_meta_params))


def make_inconsistent_num_fields_hr_warning(table_name, inconsistent_lines_info):
    assert len(inconsistent_lines_info) > 1
    inconsistent_lines_info = inconsistent_lines_info.items()
    inconsistent_lines_info = sorted(inconsistent_lines_info, key=lambda v: v[1])
    num_fields_1, lnum_1 = inconsistent_lines_info[0]
    num_fields_2, lnum_2 = inconsistent_lines_info[1]
    warn_msg = 'Number of fields in {} table is not consistent. '.format(table_name)
    warn_msg += 'E.g. there are {} fields at line {}, and {} fields at line {}.'.format(num_fields_1, lnum_1, num_fields_2, lnum_2)
    return warn_msg


def make_warnings_human_readable(warnings):
    result = list()
    for warning_type, warning_value in warnings.items():
        if warning_type == 'null_value_in_output':
            result.append('None/null values in output were replaced by empty strings.')
        elif warning_type == 'delim_in_simple_output':
            result.append('Some result set fields contain output separator.')
        elif warning_type == 'output_switch_to_csv':
            # ATTENTION: External tools depend on the exact wording of the following message:
            result.append('Output has multiple fields: using "CSV" output format instead of "Monocolumn"')
        elif warning_type == 'utf8_bom_removed':
            result.append('UTF-8 Byte Order Mark BOM was found and removed.')
        elif warning_type == 'defective_csv_line_in_input':
            result.append('Defective double quote escaping in input table. E.g. at line {}.'.format(warning_value))
        elif warning_type == 'defective_csv_line_in_join':
            result.append('Defective double quote escaping in join table. E.g. at line {}.'.format(warning_value))
        elif warning_type == 'input_fields_info':
            result.append(make_inconsistent_num_fields_hr_warning('input', warning_value))
        elif warning_type == 'join_fields_info':
            result.append(make_inconsistent_num_fields_hr_warning('join', warning_value))
        else:
            raise RuntimeError('Error: unknown warning type: {}'.format(warning_type))
    for w in result:
        assert w.find('\n') == -1
    return result


class RbqlPyEnv:
    def __init__(self):
        self.env_dir_name = None
        self.env_dir = None
        self.module_path = None
        self.module_name = None

    def __enter__(self):
        tmp_dir = tempfile.gettempdir()
        self.env_dir_name = 'rbql_{}_{}'.format(time.time(), random.randint(1, 100000000)).replace('.', '_')
        self.env_dir = os.path.join(tmp_dir, self.env_dir_name)
        self.module_name = 'worker_{}'.format(self.env_dir_name)
        module_filename = '{}.py'.format(self.module_name)
        self.module_path = os.path.join(self.env_dir, module_filename)
        os.mkdir(self.env_dir)
        shutil.copy(os.path.join(rbql_home_dir, 'rbql_utils.py'), self.env_dir)
        return self

    def import_worker(self):
        # We need to add env_dir to sys.path after worker module has been generated to avoid calling `importlib.invalidate_caches()`
        # Description of the problem: http://ballingt.com/import-invalidate-caches/
        assert os.path.exists(self.module_path), 'Unable to find generated module at {}'.format(sys.module_path)
        sys.path.append(self.env_dir)
        return importlib.import_module(self.module_name)

    def remove_env_dir(self):
        # Should be called on success only: do not put in __exit__. In case of error we may need to have the generated module
        try:
            shutil.rmtree(self.env_dir)
        except Exception:
            pass

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            sys.path.remove(self.env_dir)
        except ValueError:
            pass

