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
import base64

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
    parser.add_argument('delim', help='Delimiter')
    parser.add_argument('policy', help='csv split policy')
    parser.add_argument('query', help='Query string in rbql')
    parser.add_argument('input_table_path', metavar='FILE', help='Read csv table from FILE instead of stdin')
    parser.add_argument('encoding', help='Manually set csv table encoding')
    parser.add_argument('output_delim', help='Out Delimiter')
    parser.add_argument('output_policy', help='Out csv policy')
    args = parser.parse_args()

    delim = rbql.normalize_delim(args.delim)
    policy = args.policy
    output_delim = rbql.normalize_delim(args.output_delim)
    output_policy = args.output_policy
    query = base64.standard_b64decode(args.query).decode("utf-8")
    input_path = args.input_table_path
    csv_encoding = args.encoding

    output_path = get_dst_table_path(input_path, output_delim)
    
    run_with_python(input_path, delim, policy, csv_encoding, query, output_delim, output_policy, output_path)



if __name__ == '__main__':
    main()
