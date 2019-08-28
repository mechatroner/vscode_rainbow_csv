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

import rbql.rbql_csv


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('query', help='Query string')
    parser.add_argument('input_table_path', metavar='FILE', help='input path')
    parser.add_argument('delim', help='Delimiter')
    parser.add_argument('policy', help='csv split policy')
    parser.add_argument('output_table_path', metavar='FILE', help='output path')
    parser.add_argument('output_delim', help='Out Delimiter')
    parser.add_argument('output_policy', help='Out csv policy')
    parser.add_argument('encoding', help='encoding')
    args = parser.parse_args()

    delim = args.delim
    policy = args.policy
    output_delim = args.output_delim
    output_policy = args.output_policy
    query = base64.standard_b64decode(args.query).decode("utf-8")
    input_path = args.input_table_path
    csv_encoding = args.encoding
    output_path = args.output_table_path
    
    error_info, warnings = rbql.rbql_csv.csv_run(query, input_path, delim, policy, output_path, output_delim, output_policy, csv_encoding)
    if error_info is not None:
        error_type = error_info['type']
        error_msg = error_info['message']
        sys.stdout.write(json.dumps({'error_type': error_type, 'error_msg': error_msg}))
    else:
        if warnings is None:
            warnings = []
        sys.stdout.write(json.dumps({'warnings': warnings}))



if __name__ == '__main__':
    main()
