#!/usr/bin/env python
from __future__ import unicode_literals
from __future__ import print_function

import os
import sys
import codecs
import time
import tempfile
import subprocess
import argparse
import json

import rbql


def report_error_and_exit(error_type, error_details):
    sys.stdout.write(json.dumps({'error_type': error_type, 'error_details': error_details}))
    sys.exit()


def report_success_and_exit(report):
    sys.stdout.write(json.dumps(report))
    sys.exit()


def run_with_python(input_path, delim, policy, csv_encoding, query, output_delim, output_policy, output_path):
    with rbql.RbqlPyEnv() as worker_env:
        tmp_path = worker_env.module_path
        try:
            rbql.parse_to_py([query], tmp_path, delim, policy, output_delim, output_policy, csv_encoding, None)
        except rbql.RBParsingError as e:
            report_error_and_exit('RBQL_Parsing', str(e))
        try:
            report = {'result_path': output_path}
            rbconvert = worker_env.import_worker()
            src = None
            if input_path:
                src = codecs.open(input_path, encoding=csv_encoding)
            else:
                src = rbql.get_encoded_stdin(csv_encoding)
            warnings = None
            with codecs.open(output_path, 'w', encoding=csv_encoding) as dst:
                warnings = rbconvert.rb_transform(src, dst)
            if warnings is not None:
                warnings = rbql.make_warnings_human_readable(warnings)
                report['warnings'] = warnings
            worker_env.remove_env_dir()
            report_success_and_exit(report)
        except Exception as e:
            error_msg = 'Error: Unable to use generated python module.\n'
            error_msg += 'Location of the generated module: {}\n'.format(tmp_path)
            error_msg += 'Original python exception:\n{}'.format(str(e))
            report_error_and_exit('Wrapper', error_msg)


def run_with_js(input_path, delim, policy, csv_encoding, query, output_delim, output_policy, output_path):
    if not rbql.system_has_node_js():
        report_error_and_exit('User', 'Node.js is not found, test command: "node --version"')

    tmp_dir = tempfile.gettempdir()
    script_filename = 'rbconvert_{}'.format(time.time()).replace('.', '_') + '.js'
    tmp_path = os.path.join(tmp_dir, script_filename)
    rbql.parse_to_js(input_path, output_path, [query], tmp_path, delim, policy, output_delim, output_policy, csv_encoding, None)
    cmd = ['node', tmp_path]
    pobj = subprocess.Popen(cmd, stderr=subprocess.PIPE)
    err_data = pobj.communicate()[1]
    exit_code = pobj.returncode

    report = {'result_path': output_path}
    operation_report = rbql.parse_json_report(exit_code, err_data)
    operation_error = operation_report.get('error')
    if operation_error is not None:
        report_error_and_exit('RBQL_backend', operation_error)
    warnings = operation_report.get('warnings')
    if warnings is not None:
        warnings = rbql.make_warnings_human_readable(warnings)
        report['warnings'] = warnings
    rbql.remove_if_possible(tmp_path)
    report_success_and_exit(report)


def get_file_extension(file_name):
    p = file_name.rfind('.')
    if p == -1:
        return None
    result = file_name[p + 1:]
    if len(result):
        return result
    return None


def get_dst_table_path(src_table_path, output_delim):
    tmp_dir = tempfile.gettempdir()
    table_name = os.path.basename(src_table_path)
    orig_extension = get_file_extension(table_name)
    delim_ext_map = {'\t': 'tsv', ',': 'csv'}
    if output_delim in delim_ext_map:
        dst_extension = delim_ext_map[output_delim]
    elif orig_extension is not None:
        dst_extension = orig_extension
    else:
        dst_extension = 'txt'
    dst_table_name = '{}.{}'.format(table_name, dst_extension)
    return os.path.join(tmp_dir, dst_table_name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('backend_language', metavar='LANG', help='script language to use in query', choices=['python', 'js'])
    parser.add_argument('delim', help='Delimiter')
    parser.add_argument('policy', help='csv split policy', choices=['simple', 'quoted', 'monocolumn'])
    parser.add_argument('query', help='Query string in rbql')
    parser.add_argument('input_table_path', metavar='FILE', help='Read csv table from FILE instead of stdin')
    args = parser.parse_args()

    delim = rbql.normalize_delim(args.delim)
    policy = args.policy
    query = args.query
    input_path = args.input_table_path
    csv_encoding = rbql.default_csv_encoding
    output_delim, output_policy = delim, policy

    output_path = get_dst_table_path(input_path, output_delim)
    
    if args.backend_language == 'python':
        run_with_python(input_path, delim, policy, csv_encoding, query, output_delim, output_policy, output_path)
    else:
        run_with_js(input_path, delim, policy, csv_encoding, query, output_delim, output_policy, output_path)



if __name__ == '__main__':
    main()
