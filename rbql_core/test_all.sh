#!/usr/bin/env bash

cleanup_tmp_files() {
    rm random_ut.csv 2> /dev/null
}

skip_python_ut="False"

while test ${#} -gt 0
do
  if [ $1 == "--skip_python_ut" ]; then
      shift
      skip_python_ut="True"
  else
      echo "Error. Unknown parameter: $1" 1>&2
      shift
      exit 1
  fi
done


if [ $skip_python_ut == "False" ]; then
    python -m unittest test_rbql
    python3 -m unittest test_rbql
else
    echo "Skipping python unit tests"
fi

cleanup_tmp_files

has_node="yes"

node_version=$( node --version 2> /dev/null )
rc=$?
if [ "$rc" != 0 ] || [ -z "$node_version" ] ; then
    echo "WARNING! Node.js was not found. Skipping node unit tests"  1>&2
    has_node="no"
fi

python test_rbql.py --create_random_csv_table random_ut.csv
python test_rbql.py --test_random_csv_table random_ut.csv

py_rbql_version=$(python cli_rbql.py --version)

if [ "$has_node" == "yes" ] ; then
    node ./unit_tests.js
    node ./unit_tests.js --test_random_csv_table random_ut.csv
    js_rbql_version=$(node cli_rbql.js --version)
    if [ "$py_rbql_version" != "$js_rbql_version" ] ; then
        echo "Error: version missmatch between rbql.py ($py_rbql_version) and rbql.js ($js_rbql_version)"  1>&2
    fi
fi


# CLI tests:
md5sum_test=($( ./cli_rbql.py --query "select a1,a2,a7,b2,b3,b4 left join test_datasets/countries.tsv on a2 == b1 where 'Sci-Fi' in a7.split('|') and b2!='US' and int(a4) > 2010" < test_datasets/movies.tsv | md5sum))
md5sum_canonic=($( md5sum unit_tests/canonic_result_4.tsv ))
if [ "$md5sum_canonic" != "$md5sum_test" ] ; then
    echo "CLI test FAIL!"  1>&2
fi

if [ "$has_node" == "yes" ] ; then
    md5sum_test=($( node ./cli_rbql.js --query "select a1,a2,a7,b2,b3,b4 left join test_datasets/countries.tsv on a2 == b1 where a7.split('|').includes('Sci-Fi') && b2!='US' && a4 > 2010" < test_datasets/movies.tsv | md5sum))
    md5sum_canonic=($( md5sum unit_tests/canonic_result_4.tsv ))
    if [ "$md5sum_canonic" != "$md5sum_test" ] ; then
        echo "CLI test FAIL!"  1>&2
    fi
fi

cleanup_tmp_files

echo "Finished tests"
