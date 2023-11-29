#!/usr/bin/env python

import sys
import os
import argparse
import random
import tempfile
import json
import time


def parse_params(param_string):
    test_marker = 'test '
    assert param_string.startswith(test_marker)
    param_string = param_string[len(test_marker):]
    result = dict()
    kv_pairs = param_string.split(',')
    for p in kv_pairs:
        if p.find(':') == -1:
            continue
        key, value = p.split(':')
        result[key] = value
    return result


class MockException(RuntimeError):
    pass


def main():
    param_string = sys.argv[1]
    params = parse_params(param_string)
    output = ' '.join(sys.argv)
    tmp_dir = tempfile.gettempdir()
    tmp_file = os.path.join(tmp_dir, 'rnd_mock.{}.txt'.format(random.randint(0, 1000 * 1000 * 1000)))
    with open(tmp_file, 'w') as f:
        for i in range(10):
            f.write(param_string + '\n')
    report = {'result_path': tmp_file}


    if 'sleep' in params:
        sleep_time = float(params['sleep'])
        time.sleep(sleep_time)

    if 'error_type' in params:
        report['error_type'] = params['error_type']

    if 'error_msg' in params:
        report['error_msg'] = params['error_msg']

    if 'warnings' in params:
        report['warnings'] = params['warnings'].split(';')

    if 'unhandled_exception' in params:
        raise MockException('Unhandled Mock Exception')

    if 'handled_exception' in params:
        try:
            raise MockException('Handled Mock Exception')
        except Exception as e:
            report['error_type'] = 'Exception'
            report['error_msg'] = str(e)

    if 'stderr' in params:
        sys.stderr.write(params['stderr'])

    if 'stdout' in params:
        sys.stdout.write(params['stdout'])
    else:
        sys.stdout.write(json.dumps(report))

    if 'return_code' in params:
        return_code = int(params['return_code'])
        sys.exit(return_code)


if __name__ == '__main__':
    main()
