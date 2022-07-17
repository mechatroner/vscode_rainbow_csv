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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('query', help='Query string')
    parser.add_argument('input_table_path', metavar='FILE', help='input path')
    parser.add_argument('delim', help='Delimiter')
    parser.add_argument('policy', help='csv split policy')
    parser.add_argument('output_table_path', metavar='FILE', help='output path')
    parser.add_argument('output_delim', help='Out Delimiter')
    parser.add_argument('output_policy', help='Out csv policy')
    parser.add_argument('comment_prefix', help='Comment prefix')
    parser.add_argument('encoding', help='encoding')
    parser.add_argument('--with_headers', action='store_true', help='use headers')
    args = parser.parse_args()

    delim = args.delim
    policy = args.policy
    output_delim = args.output_delim
    output_policy = args.output_policy
    query = base64.standard_b64decode(args.query).decode("utf-8")
    input_path = args.input_table_path
    comment_prefix = args.comment_prefix if args.comment_prefix else None
    csv_encoding = args.encoding
    output_path = args.output_table_path
    with_headers = args.with_headers
    
    try:
        warnings = []
        rbql.query_csv(query, input_path, delim, policy, output_path, output_delim, output_policy, csv_encoding, warnings, with_headers, comment_prefix)
        sys.stdout.write(json.dumps({'warnings': warnings}))
    except Exception as e:
        error_type, error_msg = rbql.exception_to_error_info(e)
        sys.stdout.write(json.dumps({'error_type': error_type, 'error_msg': error_msg}))


if __name__ == '__main__':
    main()
