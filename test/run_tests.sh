#!/usr/bin/env bash

# In order to run this test:
# 1. Make sure to run `npm install` from the parent vscode_rainbow_csv directory
# 2. Close all VSCode windows

# This should work from WSL too, even if your VSCode is installed for Windows

extension_dir="$1" # path/to/vscode_rainbow_csv 
extension_tests_dir="$2" # path/to/vscode_rainbow_csv/test

if [ -z "$extension_dir" ] || [ -z "$extension_tests_dir" ]; then
    echo "Please provide extension_dir and extension_tests_dir parameters" 1>&2
    exit 1
fi

rm rainbow_csv.test.log 2> /dev/null
#code --extensionDevelopmentPath="C:\wsl_share\vscode_rainbow_csv" --extensionTestsPath="C:\wsl_share\vscode_rainbow_csv\test" --wait --new-window
code --extensionDevelopmentPath="$extension_dir" --extensionTestsPath="$extension_tests_dir" --wait --new-window
diff expected_test_log.txt rainbow_csv.test.log 1>&2
rc=$?
if [ $rc != 0 ]; then
    echo "ERROR: Some tests have failed: expected_test_log.txt log does not match the actual log: rainbow_csv.test.log. See the diff output above" 1>&2
    echo "If the log file is empty than maybe you forgot to call npm install from the parent vscode_rainbow_csv directory?" 1>&2
    exit 1
else
    echo "OK"
fi

