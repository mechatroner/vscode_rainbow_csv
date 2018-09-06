const fs = require('fs');
const readline = require('readline');
const rbql_utils = require('./rbql_utils.js');
const cli_rbql = require('./cli_rbql.js');

function arrays_are_equal(a, b) {
    if (a.length != b.length)
        return false;
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}

function assert(condition, message = null) {
    if (!condition) {
        throw message || "Assertion failed";
    }
}

function compare_splits(src, test_dst, canonic_dst, test_warning, canonic_warning) {
    if (test_warning != canonic_warning || !arrays_are_equal(test_dst, canonic_dst)) {
        console.error('Error in csv split logic. Source line: ' + src);
        console.error('Test result: ' + test_dst.join(';'));
        console.error('Canonic result: ' + canonic_dst.join(';'));
        console.error('Canonic warning: ' + canonic_warning + ', Test warning: ' + test_warning);
        process.exit(1);
    }
}

function process_random_test_line(line) {
    var records = line.split('\t');
    assert(records.length == 3);
    var escaped_entry = records[0];
    var canonic_warning = parseInt(records[1]);
    assert(canonic_warning == 0 || canonic_warning == 1);
    canonic_warning = Boolean(canonic_warning);
    var canonic_dst = records[2].split(';');
    var split_result = rbql_utils.split_quoted_str(escaped_entry, ',');
    var test_dst = split_result[0];
    var test_warning = split_result[1];

    var split_result_preserved = rbql_utils.split_quoted_str(escaped_entry, ',', true);
    assert(test_warning === split_result_preserved[1]);
    assert(split_result_preserved[0].join(',') === escaped_entry);
    if (!canonic_warning) {
        assert(arrays_are_equal(rbql_utils.unquote_fields(split_result_preserved[0]), test_dst));
    }
    if (!canonic_warning) {
        compare_splits(escaped_entry, test_dst, canonic_dst, test_warning, canonic_warning);
    }
}



function test_all() {
    var test_cases = []
    test_cases.push(['hello,world', ['hello','world'], false]);
    test_cases.push(['hello,"world"', ['hello','world'], false]);
    test_cases.push(['"abc"', ['abc'], false]);
    test_cases.push(['abc', ['abc'], false]);
    test_cases.push(['', [''], false]);
    test_cases.push([',', ['',''], false]);
    test_cases.push([',,,', ['','','',''], false]);
    test_cases.push([',"",,,', ['','','','',''], false]);
    test_cases.push(['"","",,,""', ['','','','',''], false]);
    test_cases.push(['"aaa,bbb",', ['aaa,bbb',''], false]);
    test_cases.push(['"aaa,bbb",ccc', ['aaa,bbb','ccc'], false]);
    test_cases.push(['"aaa,bbb","ccc"', ['aaa,bbb','ccc'], false]);
    test_cases.push(['"aaa,bbb","ccc,ddd"', ['aaa,bbb','ccc,ddd'], false]);
    test_cases.push(['"aaa,bbb",ccc,ddd', ['aaa,bbb','ccc', 'ddd'], false]);
    test_cases.push(['"a"aa" a,bbb",ccc,ddd', ['"a"aa" a', 'bbb"','ccc', 'ddd'], true]);
    test_cases.push(['"aa, bb, cc",ccc",ddd', ['aa, bb, cc','ccc"', 'ddd'], true]);
    test_cases.push(['hello,world,"', ['hello','world', '"'], true]);

    for (let i = 0; i < test_cases.length; i++) {
        let [src, canonic_dst, canonic_warning] = test_cases[i];
        let split_result = rbql_utils.split_quoted_str(src, ',');
        let test_dst = split_result[0];
        let test_warning = split_result[1];

        let split_result_preserved = rbql_utils.split_quoted_str(src, ',', true);
        assert(test_warning === split_result_preserved[1], 'warnings do not match');
        assert(split_result_preserved[0].join(',') === src, 'preserved restore do not match');
        if (!canonic_warning) {
            assert(arrays_are_equal(test_dst, rbql_utils.unquote_fields(split_result_preserved[0])), 'unquoted do not match');
        }
        if (!canonic_warning) {
            compare_splits(src, test_dst, canonic_dst, test_warning, canonic_warning);
        }
    }
}


function run_random_ut_mode(random_csv_table_path) {
    lineReader = readline.createInterface({ input: fs.createReadStream(random_csv_table_path, {encoding: 'binary'}) });
    lineReader.on('line', process_random_test_line);
    lineReader.on('close', function () {
        console.log('Finished split unit test');
    });
}


function main() {
    let scheme = {
        '--test_random_csv_table': {'help': 'Run in random unit test mode with FILE scenario'}
    };
    let args = cli_rbql.parse_cmd_args(process.argv, scheme);
    if (args.hasOwnProperty('test_random_csv_table')) {
        run_random_ut_mode(args['test_random_csv_table']);
        return;
    }
    test_all();
    console.log('Finished JS unit tests');
}


main();
