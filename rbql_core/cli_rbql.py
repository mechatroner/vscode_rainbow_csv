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

import rbql

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def print_error_and_exit(error_msg):
    eprint(error_msg)
    sys.exit(1)


def interpret_format(format_name):
    assert format_name in ['csv', 'tsv', 'monocolumn'], 'unknown format'
    if format_name == 'monocolumn':
        return ('', 'monocolumn')
    if format_name == 'csv':
        return (',', 'quoted')
    return ('\t', 'simple')


def run_with_python(args):
    delim = rbql.normalize_delim(args.delim)
    policy = args.policy
    if policy is None:
        policy = 'quoted' if delim in [';', ','] else 'simple'
    query = args.query
    query_path = args.query_file
    #convert_only = args.convert_only
    input_path = args.input_table_path
    output_path = args.output_table_path
    import_modules = args.libs
    csv_encoding = args.csv_encoding
    output_delim, output_policy = interpret_format(args.out_format)

    rbql_lines = None
    if query is None and query_path is None:
        print_error_and_exit('Error: provide either "--query" or "--query_path" option')
    if query is not None and query_path is not None:
        print_error_and_exit('Error: unable to use both "--query" and "--query_path" options')
    if query_path is not None:
        assert query is None
        rbql_lines = codecs.open(query_path, encoding='utf-8').readlines()
    else:
        assert query_path is None
        rbql_lines = [query]

    with rbql.RbqlPyEnv() as worker_env:
        tmp_path = worker_env.module_path
        try:
            rbql.parse_to_py(rbql_lines, tmp_path, delim, policy, output_delim, output_policy, csv_encoding, import_modules)
        except rbql.RBParsingError as e:
            print_error_and_exit('RBQL Parsing Error: \t{}'.format(e))
        try:
            rbconvert = worker_env.import_worker()
            src = None
            if input_path:
                src = codecs.open(input_path, encoding=csv_encoding)
            else:
                src = rbql.get_encoded_stdin(csv_encoding)
            warnings = None
            if output_path:
                with codecs.open(output_path, 'w', encoding=csv_encoding) as dst:
                    warnings = rbconvert.rb_transform(src, dst)
            else:
                dst = rbql.get_encoded_stdout(csv_encoding)
                warnings = rbconvert.rb_transform(src, dst)
            if warnings is not None:
                hr_warnings = rbql.make_warnings_human_readable(warnings)
                for warning in hr_warnings:
                    eprint('Warning: {}'.format(warning))
            worker_env.remove_env_dir()
        except Exception as e:
            error_msg = 'Error: Unable to use generated python module.\n'
            error_msg += 'Location of the generated module: {}\n\n'.format(tmp_path)
            error_msg += 'Original python exception:\n{}\n'.format(str(e))
            print_error_and_exit(error_msg)


def run_with_js(args):
    if not rbql.system_has_node_js():
        print_error_and_exit('Error: Node.js is not found, test command: "node --version"')
    delim = rbql.normalize_delim(args.delim)
    policy = args.policy
    if policy is None:
        policy = 'quoted' if delim in [';', ','] else 'simple'
    query = args.query
    query_path = args.query_file
    #convert_only = args.convert_only
    input_path = args.input_table_path
    output_path = args.output_table_path
    import_modules = args.libs
    csv_encoding = args.csv_encoding
    output_delim, output_policy = interpret_format(args.out_format)

    rbql_lines = None
    if query is None and query_path is None:
        print_error_and_exit('Error: provide either "--query" or "--query_path" option')
    if query is not None and query_path is not None:
        print_error_and_exit('Error: unable to use both "--query" and "--query_path" options')
    if query_path is not None:
        assert query is None
        rbql_lines = codecs.open(query_path, encoding='utf-8').readlines()
    else:
        assert query_path is None
        rbql_lines = [query]

    tmp_dir = tempfile.gettempdir()
    script_filename = 'rbconvert_{}'.format(time.time()).replace('.', '_') + '.js'
    tmp_path = os.path.join(tmp_dir, script_filename)
    rbql.parse_to_js(input_path, output_path, rbql_lines, tmp_path, delim, policy, output_delim, output_policy, csv_encoding, import_modules)
    cmd = ['node', tmp_path]
    pobj = subprocess.Popen(cmd, stderr=subprocess.PIPE)
    err_data = pobj.communicate()[1]
    exit_code = pobj.returncode

    operation_report = rbql.parse_json_report(exit_code, err_data)
    operation_error = operation_report.get('error')
    if operation_error is not None:
        error_msg = 'An error occured during js script execution:\n\n{}\n'.format(operation_error)
        error_msg += '\n================================================\n'
        error_msg += 'Generated script location: {}'.format(tmp_path)
        print_error_and_exit(error_msg)
    warnings = operation_report.get('warnings')
    if warnings is not None:
        hr_warnings = rbql.make_warnings_human_readable(warnings)
        for warning in hr_warnings:
            eprint('Warning: {}'.format(warning))
    rbql.remove_if_possible(tmp_path)




def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--delim', help='Delimiter', default='\t')
    parser.add_argument('--policy', help='csv split policy', choices=['simple', 'quoted', 'monocolumn'])
    parser.add_argument('--out_format', help='output format', default='tsv', choices=['csv', 'tsv', 'monocolumn'])
    parser.add_argument('--query', help='Query string in rbql')
    parser.add_argument('--query_file', metavar='FILE', help='Read rbql query from FILE')
    parser.add_argument('--input_table_path', metavar='FILE', help='Read csv table from FILE instead of stdin')
    parser.add_argument('--output_table_path', metavar='FILE', help='Write output table to FILE instead of stdout')
    parser.add_argument('--host_language', metavar='LANG', help='script language to use in query', default='python', choices=['python', 'js'])
    parser.add_argument('--version', action='store_true', help='Print RBQL version and exit')
    #parser.add_argument('--convert_only', action='store_true', help='Only generate script do not run query on csv table')
    parser.add_argument('--csv_encoding', help='Manually set csv table encoding', default=rbql.default_csv_encoding, choices=['latin-1', 'utf-8'])
    parser.add_argument('-I', dest='libs', action='append', help='Import module to use in the result conversion script')
    args = parser.parse_args()

    if args.version:
        print(rbql.__version__)
        return

    if args.host_language == 'python':
        run_with_python(args)
    else:
        run_with_js(args)



if __name__ == '__main__':
    main()
