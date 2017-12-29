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
    var header = ['name', 'age'];
    var sampled_entries = [['Dima', '29'], ['Alice', '1.5']];
    var is_header = rainbow_utils.guess_if_header(header, sampled_entries);
    assert(is_header, "test 1 has failed");
}

function test2() {
    var header = ['name', 'age'];
    var sampled_entries = [['Dima', 'twenty nine'], ['Alice', 'one']];
    var is_header = rainbow_utils.guess_if_header(header, sampled_entries);
    assert(!is_header, "test 2 has failed");
}

function test_all() {
    test1();
    test2();
}

test_all();
