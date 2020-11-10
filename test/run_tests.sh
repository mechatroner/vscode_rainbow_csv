#!/usr/bin/env bash

# This should work from WSL too, even if your VSCode is installed for Windows

extension_dir="$1" # path/to/vscode_rainbow_csv 
extension_tests_dir="$2" # path/to/vscode_rainbow_csv/test

rm rainbow_csv.test.log 2> /dev/null
#code --extensionDevelopmentPath="C:\wsl_share\vscode_rainbow_csv" --extensionTestsPath="C:\wsl_share\vscode_rainbow_csv\test" --wait --new-window
code --extensionDevelopmentPath="$extension_dir" --extensionTestsPath="$extension_tests_dir" --wait --new-window
diff expected_test_log.txt rainbow_csv.test.log 1>&2
rc=$?
if [ $rc != 0 ]; then
    echo "ERROR: Some tests have failed: expected_test_log.txt log does not match the actual log: rainbow_csv.test.log. See the diff output above" 1>&2
else
    echo "OK"
fi

