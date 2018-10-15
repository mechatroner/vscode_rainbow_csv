#!/usr/bin/env bash

cleanup_tmp_files() {
    rm random_ut.csv 2> /dev/null
}

cleanup_tmp_files

node ./unit_tests.js
#node ./unit_tests.js --test_random_csv_table random_ut.csv

if [ "$has_node" == "yes" ] ; then
    md5sum_test=($( node ./cli_rbql.js --query "select a1,a2,a7,b2,b3,b4 left join test_datasets/countries.tsv on a2 == b1 where a7.split('|').includes('Sci-Fi') && b2!='US' && a4 > 2010" < test_datasets/movies.tsv | md5sum))
    md5sum_canonic="d5b7730ed95818438bce492e3f69df36"
    if [ "$md5sum_canonic" != "$md5sum_test" ] ; then
        echo "CLI test FAIL!"  1>&2
    fi
fi

cleanup_tmp_files

echo "Finished tests"
