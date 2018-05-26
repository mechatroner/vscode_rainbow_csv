rainbow_utils = require('./rainbow_utils.js')

function exit_with_error_msg(error_msg) {
    process.stderr.write('Error:\n' + error_msg + '\n');
    process.exit(1);
}

function assert(condition, message) {
    if (!condition) {
        exit_with_error_msg(message);
    }
}

function test1() {
    var string1 = 'Dima,Liuba,Alice,"and all, and all"';
    var split_result = rainbow_utils.smart_split(string1, ',', 'quoted', false);
    assert(JSON.stringify(split_result) == JSON.stringify([['Dima', 'Liuba', 'Alice', 'and all, and all'], false]), "test 1 has failed");
}


function test_all() {
    test1();
}

test_all();
