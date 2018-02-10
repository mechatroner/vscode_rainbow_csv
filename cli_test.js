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


function test3() {
    var header = ['type', 'story'];
    var sampled_entries = [['fairytale', 'Once upon a time there was a beautiful girl who lived...'], ['romance', 'She looked outside her window and saw an approaching ship']];
    var is_header = rainbow_utils.guess_if_header(header, sampled_entries);
    assert(!is_header, "test 3 has failed");
}

function test4() {
    var header = ['type', 'story'];
    var sampled_entries = [['fairytale', 'Once upon a time there was a beautiful girl who lived...'], ['romance', 'She looked outside her window and saw an approaching ship'], ['none', 'none']];
    var is_header = rainbow_utils.guess_if_header(header, sampled_entries);
    assert(!is_header, "test 4 has failed");
}

function test5() {
    var header = ['name', 'age'];
    var sampled_entries = [['Dima', '29'], ['Alice', '1.5'], ['29', 'Liuba']];
    var is_header = rainbow_utils.guess_if_header(header, sampled_entries);
    assert(!is_header, "test 5 has failed");
}

function test6() {
    var header = ['type', 'story'];
    var sampled_entries = [['fairytale', 'Once upon a time there was a beautiful girl who lived... 128'], ['romance', 'She looked outside her window and saw an approaching ship 200']];
    var is_header = rainbow_utils.guess_if_header(header, sampled_entries);
    assert(!is_header, "test 6 has failed");
}

function test_all() {
    test1();
    test2();
    test3();
    test4();
    test5();
}

test_all();
