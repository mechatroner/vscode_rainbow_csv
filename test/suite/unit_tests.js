const assert = require('assert');
const rainbow_utils = require('../../rainbow_utils.js');
const fast_load_utils = require('../../fast_load_utils.js');


class VscodePositionTestDouble {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class VscodeRangeTestDouble {
    constructor(l1, c1, l2, c2) {
        this.start = new VscodePositionTestDouble(l1, c1);
        this.end = new VscodePositionTestDouble(l2, c2);
    }
}


class VscodeDocumentTestDouble {
    constructor(lines_buffer) {
        this.lines_buffer = lines_buffer;
        this.lineCount = lines_buffer.length;
    }
    lineAt(lnum) {
        return {text: this.lines_buffer[lnum]};
    }
}


let vscode_test_double = {Range: VscodeRangeTestDouble};


//rainbow_utils.set_vscode(vscode_test_double);


function test_align_stats() {
    // Previous fields are numbers but the current one is not - mark the column as non-numeric.
    let field = 'foobar';
    let is_first_line = 0;
    let field_components = [5, 2, 3];
    rainbow_utils.update_subcomponent_stats(field, is_first_line, field_components);
    assert.deepEqual(field_components, [6, -1, -1]);

    // The field is non-numeric but it is at the first line so could be a header - do not mark the column as non-numeric just yet.
    field = 'foobar';
    is_first_line = 1;
    field_components = [0, 0, 0];
    rainbow_utils.update_subcomponent_stats(field, is_first_line, field_components);
    assert.deepEqual(field_components, [6, 0, 0]);

    // The field is a number but the column is already marked as non-numeric so we just update the max string width.
    field = '100000';
    is_first_line = 0;
    field_components = [2, -1, -1];
    rainbow_utils.update_subcomponent_stats(field, is_first_line, field_components);
    assert.deepEqual(field_components, [6, -1, -1]);

    // Empty field should not mark a potentially numeric column as non-numeric.
    field = '';
    is_first_line = 0;
    field_components = [5, 2, 3];
    rainbow_utils.update_subcomponent_stats(field, is_first_line, field_components);
    assert.deepEqual(field_components, [5, 2, 3]);

    // The field doesn't change stats because all of 3 components are smaller than the current maximums.
    field = '100.3';
    is_first_line = 0;
    field_components = [7, 4, 3];
    rainbow_utils.update_subcomponent_stats(field, is_first_line, field_components);
    assert.deepEqual(field_components, [7, 4, 3]);

    // Integer update example.
    field = '100000';
    is_first_line = 0;
    field_components = [5, 2, 3];
    rainbow_utils.update_subcomponent_stats(field, is_first_line, field_components);
    assert.deepEqual(field_components, [6, 6, 3]);

    // Float update example.
    field = '1000.23';
    is_first_line = 0;
    field_components = [3, 3, 0];
    rainbow_utils.update_subcomponent_stats(field, is_first_line, field_components);
    assert.deepEqual(field_components, [7, 4, 3]);
}


function test_field_align() {
    // Align field in non-numeric non-last column.
    let field = 'foobar';
    let is_first_line = 0;
    let max_components_lens = [10, -1, -1];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    let is_last_column = 0;
    let aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('foobar     ', aligned_field);

    // Align field in non-numeric last column.
    field = 'foobar';
    is_first_line = 0;
    max_components_lens = [10, -1, -1];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 1;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('foobar', aligned_field);

    // Align non-numeric first line (potentially header) field in numeric column.
    field = 'foobar';
    is_first_line = 1;
    max_components_lens = [10, 4, 6];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('foobar     ', aligned_field);

    // Align numeric first line (potentially header) field in numeric column.
    field = '10.1';
    is_first_line = 1;
    max_components_lens = [10, 4, 6];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('  10.1     ', aligned_field);

    // Align numeric field in non-numeric column (first line).
    field = '10.1';
    is_first_line = 1;
    max_components_lens = [10, -1, -1];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('10.1       ', aligned_field);

    // Align numeric field in non-numeric column (not first line).
    field = '10.1';
    is_first_line = 0;
    max_components_lens = [10, -1, -1];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('10.1       ', aligned_field);

    // Align numeric float in numeric non-last column.
    field = '10.1';
    is_first_line = 0;
    max_components_lens = [10, 4, 6];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('  10.1     ', aligned_field);

    // Align numeric float in numeric last column.
    field = '10.1';
    is_first_line = 0;
    max_components_lens = [10, 4, 6];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 1;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('  10.1', aligned_field);

    // Align numeric integer in numeric non-last column.
    field = '1000';
    is_first_line = 0;
    max_components_lens = [10, 4, 6];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('1000       ', aligned_field);

    // Align numeric integer in numeric last column.
    field = '1000';
    is_first_line = 0;
    max_components_lens = [10, 4, 6];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 1;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('1000', aligned_field);

    // Align numeric integer in numeric (integer) column.
    field = '1000';
    is_first_line = 0;
    max_components_lens = [4, 4, 0];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('1000 ', aligned_field);

    // Align numeric integer in numeric (integer) column dominated by header width.
    field = '1000';
    is_first_line = 0;
    max_components_lens = [6, 4, 0];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('  1000 ', aligned_field);

    // Align numeric float in numeric column dominated by header width.
    field = '10.1';
    is_first_line = 0;
    max_components_lens = [12, 4, 6];
    max_components_lens = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    is_last_column = 0;
    aligned_field = rainbow_utils.align_field(field, is_first_line, max_components_lens, is_last_column);
    assert.deepEqual('    10.1     ', aligned_field);
}


function test_adjust_column_stats() {
    // Not a numeric column, adjustment is NOOP.
    let max_components_lens = [10, -1, -1];
    let adjusted_components = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    assert.deepEqual([10, -1, -1], adjusted_components);

    // This is possisble with a single-line file.
    max_components_lens = [10, 0, 0];
    adjusted_components = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    assert.deepEqual([10, -1, -1], adjusted_components);

    // Header is smaller than the sum of the numeric components.
    // value
    // 0.12
    // 1234
    max_components_lens = [5, 4, 3];
    adjusted_components = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    assert.deepEqual([7, 4, 3], adjusted_components);

    // Header is bigger than the sum of the numeric components.
    max_components_lens = [10, 4, 3];
    adjusted_components = rainbow_utils.adjust_column_stats([max_components_lens])[0];
    assert.deepEqual([10, 7, 3], adjusted_components);
}


function test_parse_document_records() {
    let [doc_lines, active_doc, comment_prefix, delim, policy] = [null, null, null, null, null];
    let [records, fields_info, first_defective_line, first_trailing_space_line] = [null, null, null, null];

    // Simple test with single-field records and max_records_to_parse set to a very big number.
    doc_lines = ['aaa', 'bbb', 'ccc'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/1000, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['aaa'], ['bbb'], ['ccc']], records);
    assert.deepEqual([[1, 0]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, null);

    // Simple test with two-field records and a comment and a trailing space line.
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1 ,c2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1 ', 'c2']], records);
    assert.deepEqual([[2, 0]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    // The first trailing space line is line 3 (0-based) because the comment line also counts for a document line.
    assert.equal(first_trailing_space_line, 3);

    // Simple test with inconsistent records and trailing space.
    doc_lines = ['a1,a2 ', 'b1,b2', '', 'c1', 'd3,d4,d5'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2 '], ['b1', 'b2'], [''], ['c1'], ['d3', 'd4', 'd5']], records);
    assert.deepEqual([[2, 0], [1, 2], [3, 4]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, 0);

    // Quoted policy, defective line 3, do not stop on warning.
    doc_lines = ['a1,a2', '#"b1,b2', '"b1,b2', 'c1', 'd3,d4,d5'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2'], ['"b1', 'b2'], ['c1'], ['d3', 'd4', 'd5']], records);
    assert.equal(first_defective_line, 2);
    assert.equal(first_trailing_space_line, null);

    // Quoted policy, defective line 3, stop on warning.
    doc_lines = ['a1,a2', '#"b1,b2', '"b1,b2', 'c1', 'd3,d4,d5'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2']], records);
    assert.equal(first_defective_line, 2);
    assert.equal(first_trailing_space_line, null);

    // Quoted rfc policy - no issues.
    doc_lines = ['a1,"a2', 'b1"",b2 ', 'c1,c2",c3', '#d1,"', '"e1,""e2,e3"', 'f1 ,f2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2\nb1",b2 \nc1,c2', 'c3'], ['e1,"e2,e3'], ['f1 ', 'f2']], records);
    assert.equal(first_defective_line, null);
    // Trailing spaces inside the fields do not count, so the first trailing space will be at line 5.
    assert.equal(first_trailing_space_line, 5);

    // Quoted rfc policy - stop on warning.
    doc_lines = ['a1,"a2', 'b1"",b2 ', 'c1,"c2,c3', '#d1,"', '"e1,""e2,e3"', 'f1 ,f2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([], records);
    assert.equal(first_defective_line, 0);

    // too few columns for autodetection
    doc_lines = ['a1', 'b1', 'c1'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/false, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
    assert.equal(null, records);
    // Only one entry in fields_info because of the early stop because of min_num_fields_for_autodetection check.
    assert.deepEqual([[1, 0]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, null);

    // Autodetection - enough columns.
    doc_lines = ['a1,a2', 'b1,b2', 'c1,c2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/false, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
    assert.equal(null, records);
    assert.deepEqual([[2, 0]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, null);

    // Autodetection - different number of columns - early stop.
    doc_lines = ['a1,a2', 'b1,b2', 'c1,c2,c3', 'd1,d3'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
    // Because of the early stop we don't parse the last 2 lines.
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2']], records);
    // Make sure that we have two entries in fields_info - callers check fields_info to find out if we have autodetection failure.
    assert.deepEqual([[2, 0], [3, 2]], Array.from(fields_info.entries()));

    // Max record to parse - no defective line.
    doc_lines = ['a1,a2', 'b1,b2', '"c1,c2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted_rfc';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/2, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2']], records);
    // Although the third line is defective we don't detect it because of max_records_to_parse limitation.
    assert.equal(first_defective_line, null);

    // Max record to parse - defective line. 
    doc_lines = ['a1,a2', 'b1,b2', '"c1,c2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted_rfc';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/5, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2']], records);
    // Although the third line is defective we don't detect it because of max_records_to_parse limitation.
    assert.equal(first_defective_line, 2);

    // Simple multichar separator, max_records_to_parse equals total number of records.
    doc_lines = ['a1#~#a2#~#a3', 'b1#~#b2#~#b3', 'c1#~#c2#~#c3'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = '#~#';
    policy = 'simple';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/3, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']], records);
    assert.equal(first_defective_line, null);

    // Whitespace policy, trailing spaces are impossible for this policy.
    doc_lines = ['  a1 a2    a3', 'b1     b2 b3  ', '  c1    c2       c3  '];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ' ';
    policy = 'whitespace';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/3, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']], records);
    assert.equal(first_defective_line, null);
    // Although we have a lot of internal spaces, the first_trailing_space_line should be null because we use whitespace policy
    assert.equal(first_trailing_space_line, null);
}


function test_all() {
    test_align_stats();
    test_field_align();
    test_adjust_column_stats();
    test_parse_document_records();
}

exports.test_all = test_all;

