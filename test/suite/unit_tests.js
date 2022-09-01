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
    contains(position) {
        let after_start = position.line > this.start.line || (position.line === this.start.line && position.character >= this.start.character);
        let before_end = position.line < this.end.line || (position.line == this.end.line && position.character <= this.end.character);
        return after_start && before_end;
    }
}


class VscodeDocumentTestDouble {
    constructor(lines_buffer, fileName='TestDouble.txt', language_id='plaintext') {
        this.lines_buffer = lines_buffer;
        this.lineCount = lines_buffer.length;
        this.fileName = fileName;
        this.version = 1;
        this.languageId = language_id;
    }
    lineAt(lnum) {
        return {text: this.lines_buffer[lnum]};
    }
    getText() {
        return this.lines_buffer.join('\n');
    }
}


class VscodeStatusBarItemTestDouble {
    constructor() {
        this.text = null;
        this.color = null;
        this.tooltip = null;
        this.command = null;
        this.is_visible = false;
    }
    show() {
        this.is_visible = true;
    }
}


function create_status_bar_item_test_double(_alignment) {
    return new VscodeStatusBarItemTestDouble();
}


function set_text_document_language_test_double(target_document, language_id) {
    target_document.languageId = language_id;
    return target_document;
}


let vscode_test_double = {Range: VscodeRangeTestDouble, 'window': {'createStatusBarItem': create_status_bar_item_test_double}, 'StatusBarAlignment': {'Left': null}, 'languages': {'setTextDocumentLanguage': set_text_document_language_test_double}};


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
    let [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = [null, null, null, null, null];

    // Simple test with single-field records and max_records_to_parse set to a very big number.
    doc_lines = ['aaa', 'bbb', 'ccc'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/1000, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['aaa'], ['bbb'], ['ccc']], records);
    assert.deepEqual([[1, 0]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, null);
    assert.equal(num_records_parsed, records.length);

    // Simple test with two-field records and a comment and a trailing space line.
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1 ,c2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
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
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
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
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2'], ['"b1', 'b2'], ['c1'], ['d3', 'd4', 'd5']], records);
    assert.equal(first_defective_line, 2);
    assert.equal(first_trailing_space_line, null);

    // Quoted policy, defective line 3, stop on warning.
    doc_lines = ['a1,a2', '#"b1,b2', '"b1,b2', 'c1', 'd3,d4,d5'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2']], records);
    assert.equal(first_defective_line, 2);
    assert.equal(first_trailing_space_line, null);

    // Quoted rfc policy - no issues.
    doc_lines = ['a1,"a2', 'b1"",b2 ', 'c1,c2",c3', '#d1,"', '"e1,""e2,e3"', 'f1 ,f2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
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
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([], records);
    assert.equal(first_defective_line, 0);

    // too few columns for autodetection
    doc_lines = ['a1', 'b1', 'c1'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/false, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
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
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/false, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
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
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
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
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/2, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2']], records);
    // Although the third line is defective we don't detect it because of max_records_to_parse limitation.
    assert.equal(first_defective_line, null);

    // Max record to parse - defective line. 
    doc_lines = ['a1,a2', 'b1,b2', '"c1,c2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted_rfc';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/5, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2']], records);
    // Although the third line is defective we don't detect it because of max_records_to_parse limitation.
    assert.equal(first_defective_line, 2);

    // Simple multichar separator, max_records_to_parse equals total number of records.
    doc_lines = ['a1#~#a2#~#a3', 'b1#~#b2#~#b3', 'c1#~#c2#~#c3'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = '#~#';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/3, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']], records);
    assert.equal(first_defective_line, null);

    // Whitespace policy, trailing spaces are impossible for this policy.
    doc_lines = ['  a1 a2    a3', 'b1     b2 b3  ', '  c1    c2       c3  '];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ' ';
    policy = 'whitespace';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/3, /*collect_records=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']], records);
    assert.equal(first_defective_line, null);
    // Although we have a lot of internal spaces, the first_trailing_space_line should be null because we use whitespace policy
    assert.equal(first_trailing_space_line, null);
}


function line_range_to_triple(vscode_range) {
    assert.equal(vscode_range.start.line, vscode_range.end.line);
    return [vscode_range.start.line, vscode_range.start.character, vscode_range.end.character];
}

function convert_ranges_to_triples(table_ranges) {
    let table_comment_ranges = [];
    let table_record_ranges = [];
    for (let row_info of table_ranges) {
        if (row_info.hasOwnProperty('comment_range')) {
            table_comment_ranges.push(line_range_to_triple(row_info.comment_range));
        } else {
            assert(row_info.hasOwnProperty('record_ranges'));
            let row_triple_groups = [];
            for (let field_ranges of row_info.record_ranges) {
                let field_triples = [];
                for (let field_range of field_ranges) {
                    field_triples.push(line_range_to_triple(field_range));
                }
                row_triple_groups.push(field_triples);
            }
            table_record_ranges.push(row_triple_groups);
        }
    }
    return [table_comment_ranges, table_record_ranges];
}

function vr(l1, c1, l2, c2) {
    return new VscodeRangeTestDouble(l1, c1, l2, c2);
}

// Flat Vscode Record. Use function for readability.
function fvr(l, c1, c2) {
    return [l, c1, c2];
}


function test_parse_document_range_rfc() {
    let [doc_lines, active_doc, comment_prefix, delim, range] = [null, null, null, null, null];
    let [table_ranges, table_comment_ranges, table_record_ranges] = [null, null, null];
    let [record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3] = [null, null, null, null];
    // Simple test case.
    doc_lines = ['a1,a2', 'b1,b2', 'c1,c2', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 3, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Test last line parsing.
    doc_lines = ['a1,a2', 'b1,b2', 'c1,c2', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 4, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(3, 0, 3)], [fvr(3, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Test behind last line and before first line parsing with large margin.
    doc_lines = ['a1,a2', 'b1,b2', 'c1,c2', '#comment', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 5, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/100);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([fvr(3, 0, 8)], table_comment_ranges);

    // Test extension with the default margin.
    doc_lines = ['a1,a2', 'b1,b2', 'c1,c2', '#comment', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    // The range covers only one line, but the default margin=50 should extend it to cover everything.
    range = new vscode_test_double.Range(2, 0, 2, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([fvr(3, 0, 8)], table_comment_ranges);


    // Single record, 3 fields.
    doc_lines = ['a1,"a2', 'b1,b2', 'c1,c2', 'd1",d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 4, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, comment_prefix, range, /*custom_parsing_margin=*/100);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 6), fvr(1, 0, 5), fvr(2, 0, 5), fvr(3, 0, 4)], [fvr(3, 4, 6)]];
    assert.deepEqual([record_ranges_0], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Mixture of single line and multiline fields in a single record. Also a comment prefix in the middle of the field which should not count.
    doc_lines = ['a1,a2,"a3', '#b1","b2"",b3",b4,"b5', 'c1,c2"'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 4, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/100);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 6)], [fvr(0, 6, 9), fvr(1, 0, 5)], [fvr(1, 5, 15)], [fvr(1, 15, 18)], [fvr(1, 18, 21), fvr(2, 0, 6)]];
    assert.deepEqual([record_ranges_0], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Discard some parsed lines which belongs to a record starting outside the parsing range
    doc_lines = ['a1,"a2', 'b1,b2', 'c1,c2', 'd1,d2"', 'e1,e2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 20, 0); // doesn't include first line with the openning double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Now shift window one back - it should include all lines now.
    doc_lines = ['a1,"a2', 'b1,b2', 'c1,c2', 'd1,d2"', 'e1,e2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 20, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 6), fvr(1, 0, 5), fvr(2, 0, 5), fvr(3, 0, 6)]];
    record_ranges_1 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Include only the first 2 records because end of the record is outside the parsing window.
    doc_lines = ['a1,a2', 'b1,b2', 'c1,"c2', 'd1,d2', 'e1,e2', 'f1,f2"'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 5, 0); // doesn't include the last line with the closing double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Now include everything because the end record got inside the parsing window
    doc_lines = ['a1,a2', 'b1,b2', 'c1,"c2', 'd1,d2', 'e1,e2', 'f1,f2"'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 6, 0); // doesn't include the last line with the closing double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 6), fvr(3, 0, 5), fvr(4, 0, 5), fvr(5, 0, 6)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // =================================================================================== 
    // Beginning of 4 related test on the same data but with the different parsing windows

    // Nothing is parsed because the window started at the record which end didn't fit into the parsing range.
    doc_lines = ['a1,"a2', 'b1,b2', 'c1","c2', 'd1,d2', '#hello world', 'e1,e2', 'f1",f2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 6, 0); // doesn't include the last line with the closing double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    assert.deepEqual([], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);
   
    // Same as before but the window is shifted slightly so we (wrongly) assume that the internal field lines are independent records.
    doc_lines = ['a1,"a2', 'b1,b2', 'c1","c2', 'd1,d2', '#hello world', 'e1,e2', 'f1",f2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 6, 0); // doesn't include the last line with the closing double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    // Note that the third line `c1","c2` is not parsed because since parser assumes it to be an independent record it contains syntax errors.
    record_ranges_1 = [[fvr(3, 0, 3)], [fvr(3, 3, 5)]];
    record_ranges_2 = [[fvr(5, 0, 3)], [fvr(5, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2], table_record_ranges);
    // Although `#hello world` is actually part of the multiline field we wrongly assume it to be a comment since our parsing window don't cover neither begin nor end of the record.
    assert.deepEqual([fvr(4, 0, 12)], table_comment_ranges);

    // Nothing is parsed again because the window ends right at the closing line and the beginning didn't fit.
    doc_lines = ['a1,"a2', 'b1,b2', 'c1","c2', 'd1,d2', '#hello world', 'e1,e2', 'f1",f2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 7, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    assert.deepEqual([], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);
    

    // All lines now fit in the range and they are being properly parsed as a single record.
    doc_lines = ['a1,"a2', 'b1,b2', 'c1","c2', 'd1,d2', '#hello world', 'e1,e2', 'f1",f2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 7, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*comment_prefix=*/'#', range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 6), fvr(1, 0, 5), fvr(2, 0, 4)], [fvr(2, 4, 7), fvr(3, 0, 5), fvr(4, 0, 12), fvr(5, 0, 5), fvr(6, 0, 4)], [fvr(6, 4, 6)]];
    assert.deepEqual([record_ranges_0], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);


    // End of 4 related test on the same data but with the different parsing windows
    // =================================================================================== 


    // Discard some at the beginning and some at the end where the record didn't fit into the parsing window
    doc_lines = ['a1;"a2', 'b1;b2', 'c1";c2', 'd1;d2', '#hello world', 'e1;e2', 'f1;"f2', 'g1;g2', 'h1";h2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ';';
    range = new vscode_test_double.Range(1, 0, 8, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(3, 0, 3)], [fvr(3, 3, 5)]];
    record_ranges_2 = [[fvr(5, 0, 3)], [fvr(5, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2], table_record_ranges);
    assert.deepEqual([fvr(4, 0, 12)], table_comment_ranges);

}


function test_is_opening_rfc_line() {
    assert(rainbow_utils.is_opening_rfc_line('a1,"a2', ','));
    assert(rainbow_utils.is_opening_rfc_line('a1;"a2', ';'));
    assert(rainbow_utils.is_opening_rfc_line('a1,  " a2', ','));
    assert(rainbow_utils.is_opening_rfc_line('a1  ,  " a2', ','));
    assert(rainbow_utils.is_opening_rfc_line('a1,a1,a1  ,  " a2', ','));
    assert(rainbow_utils.is_opening_rfc_line('a1,"a1,a1  ",  " a2', ','));
    assert(rainbow_utils.is_opening_rfc_line('a1,"a1,a1  " ,  " a2', ','));
    assert(!rainbow_utils.is_opening_rfc_line('a1,a2', ','));
    assert(!rainbow_utils.is_opening_rfc_line('a1",a2', ','));
    assert(!rainbow_utils.is_opening_rfc_line('a1;a2', ';'));
    assert(!rainbow_utils.is_opening_rfc_line('a1";a2', ';'));

    // Some lines can be both closing and opening, e.g. this one:
    assert(rainbow_utils.is_opening_rfc_line('",a2,a3', ','));

    assert(!rainbow_utils.is_opening_rfc_line('abcd"', ','));
    assert(!rainbow_utils.is_opening_rfc_line('abcd",ab', ','));
    assert(!rainbow_utils.is_opening_rfc_line('ab,cd",ab', ','));
    assert(!rainbow_utils.is_opening_rfc_line('ab""x""cd",ab', ','));
    assert(!rainbow_utils.is_opening_rfc_line('a1,"a2,a3""a4,a5""",a6,a7', ','));
    assert(rainbow_utils.is_opening_rfc_line('"', ','));
    assert(rainbow_utils.is_opening_rfc_line('",', ','));
    assert(rainbow_utils.is_opening_rfc_line(',"', ','));
    assert(rainbow_utils.is_opening_rfc_line('a,"', ','));
    assert(!rainbow_utils.is_opening_rfc_line('a,a"', ','));
}


function test_sample_preview_records_from_context() {
    let [doc_lines, active_doc, comment_prefix, delim, rbql_context, preview_window_size, cached_table_parse_result, dst_message, policy] = [null, null, null, null, null, null, null, null, null];
    let doc_file_name = 'fake_doc.txt';

    // Simple test with a comment and negative start record.
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1,c2', 'd1,d2'];
    delim = ',';
    comment_prefix = '#';
    preview_window_size = 10;
    active_doc = new VscodeDocumentTestDouble(doc_lines, doc_file_name);
    requested_start_record = -100;
    cached_table_parse_result = new Map();
    dst_message = new Object();
    policy = 'simple';
    rbql_context = {input_document: active_doc, delim: delim, policy: policy, comment_prefix: comment_prefix, requested_start_record: requested_start_record};
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    assert.equal(dst_message.actual_start_record, 0);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2'], ['d1', 'd2']], dst_message.preview_records);
    assert(!cached_table_parse_result.has(doc_file_name));

    // Invalid quoting.
    doc_lines = ['a1,"a2', 'b1",b2', '#comment', 'c1,"c2', 'd1,d2'];
    delim = ',';
    comment_prefix = '#';
    preview_window_size = 10;
    active_doc = new VscodeDocumentTestDouble(doc_lines, doc_file_name);
    requested_start_record = 0;
    cached_table_parse_result = new Map();
    dst_message = new Object();
    policy = 'quoted_rfc';
    rbql_context = {input_document: active_doc, delim: delim, policy: policy, comment_prefix: comment_prefix, requested_start_record: requested_start_record};
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    assert(!dst_message.actual_start_record);
    assert(!dst_message.preview_records);
    assert.equal(dst_message.preview_sampling_error, 'Double quotes are not consistent in record 2 which starts at line 4');
    assert(!cached_table_parse_result.has(doc_file_name));

    // Test window shift back to 0.
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1,c2', 'd1,d2', 'e1,e2'];
    delim = ',';
    comment_prefix = '#';
    preview_window_size = 10;
    active_doc = new VscodeDocumentTestDouble(doc_lines, doc_file_name);
    requested_start_record = 3;
    cached_table_parse_result = new Map();
    dst_message = new Object();
    policy = 'simple';
    rbql_context = {input_document: active_doc, delim: delim, policy: policy, comment_prefix: comment_prefix, requested_start_record: requested_start_record};
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    // The start record is shifted to record 1 from requested record 3 to show the maximum number of the requested 10 entries.
    assert.equal(dst_message.actual_start_record, 0);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2'], ['d1', 'd2'], ['e1', 'e2']], dst_message.preview_records);
    assert(!cached_table_parse_result.has(doc_file_name));

    // Test window shift back exact.
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1,c2', 'd1,d2', 'e1,e2'];
    delim = ',';
    comment_prefix = '#';
    preview_window_size = 4;
    active_doc = new VscodeDocumentTestDouble(doc_lines, doc_file_name);
    requested_start_record = 3;
    cached_table_parse_result = new Map();
    dst_message = new Object();
    policy = 'simple';
    rbql_context = {input_document: active_doc, delim: delim, policy: policy, comment_prefix: comment_prefix, requested_start_record: requested_start_record};
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    // The start record is shifted to record 1 from requested record 3 to show the requested 4 entries.
    assert.equal(dst_message.actual_start_record, 1);
    assert.deepEqual([['b1', 'b2'], ['c1', 'c2'], ['d1', 'd2'], ['e1', 'e2']], dst_message.preview_records);
    assert(!cached_table_parse_result.has(doc_file_name));

    // Test UI_STRING_TRIM_MARKER behavior.
    doc_lines = ['1'.repeat(251) + ',' + '2'.repeat(251)];
    delim = ',';
    comment_prefix = '#';
    preview_window_size = 4;
    active_doc = new VscodeDocumentTestDouble(doc_lines, doc_file_name);
    requested_start_record = 3;
    cached_table_parse_result = new Map();
    dst_message = new Object();
    policy = 'simple';
    rbql_context = {input_document: active_doc, delim: delim, policy: policy, comment_prefix: comment_prefix, requested_start_record: requested_start_record};
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    assert.equal(dst_message.actual_start_record, 0);
    assert.deepEqual([['1'.repeat(250) + '###UI_STRING_TRIM_MARKER###', '2'.repeat(250) + '###UI_STRING_TRIM_MARKER###']], dst_message.preview_records);
    assert(!cached_table_parse_result.has(doc_file_name));

    // Test that comment lines do not prevent to sample requested number of entries.
    doc_lines = ['#info', '#info', '#info', '#info', '#info', '#info', '#info', '#info', '#info', '#info', 'a1,a2', 'b1,b2', '#comment', 'c1,c2', 'd1,d2'];
    delim = ',';
    comment_prefix = '#';
    preview_window_size = 3;
    active_doc = new VscodeDocumentTestDouble(doc_lines, doc_file_name);
    requested_start_record = 0;
    cached_table_parse_result = new Map();
    dst_message = new Object();
    policy = 'simple';
    rbql_context = {input_document: active_doc, delim: delim, policy: policy, comment_prefix: comment_prefix, requested_start_record: requested_start_record};
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    assert.equal(dst_message.actual_start_record, 0);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']], dst_message.preview_records);
    assert(!cached_table_parse_result.has(doc_file_name));

    // Check caching logic.
    doc_lines = ['a1,a2', 'b1,b2', 'c1,c2', '#comment', 'd1,d2', 'e1,e2', 'f1,f2', 'g1,g2', 'h1,h2', 'i1,i2', 'j1,j2', 'k1,k2', 'l1,l2', 'm1,m2', 'n1,n2', 'o1"",o2'];
    delim = ',';
    comment_prefix = '#';
    preview_window_size = 2;
    active_doc = new VscodeDocumentTestDouble(doc_lines, doc_file_name);
    requested_start_record = 11;
    cached_table_parse_result = new Map();
    dst_message = new Object();
    policy = 'quoted_rfc';
    rbql_context = {input_document: active_doc, delim: delim, policy: policy, comment_prefix: comment_prefix, requested_start_record: requested_start_record};
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    assert.equal(dst_message.preview_sampling_error, 'Double quotes are not consistent in record 15 which starts at line 16');
    assert(cached_table_parse_result.has(doc_file_name));
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2'], ['d1', 'd2'], ['e1', 'e2'], ['f1', 'f2'], ['g1', 'g2'], ['h1', 'h2'], ['i1', 'i2'], ['j1', 'j2'], ['k1', 'k2'], ['l1', 'l2'], ['m1', 'm2'], ['n1', 'n2']], cached_table_parse_result.get(doc_file_name)[0]);
    assert.equal(15, cached_table_parse_result.get(doc_file_name)[1]); // First failed line.
    assert.equal(1, cached_table_parse_result.get(doc_file_name)[2]); // Doc verion.

    // Check that even with the updated doc the old version is returned because we haven't adjusted the version.
    dst_message = new Object();
    active_doc.lines_buffer[active_doc.lines_buffer.length - 1] = 'o1,o2';
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    assert.equal(dst_message.preview_sampling_error, 'Double quotes are not consistent in record 15 which starts at line 16');
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2'], ['d1', 'd2'], ['e1', 'e2'], ['f1', 'f2'], ['g1', 'g2'], ['h1', 'h2'], ['i1', 'i2'], ['j1', 'j2'], ['k1', 'k2'], ['l1', 'l2'], ['m1', 'm2'], ['n1', 'n2']], cached_table_parse_result.get(doc_file_name)[0]);
    assert.equal(15, cached_table_parse_result.get(doc_file_name)[1]); // First failed line.
    assert.equal(1, cached_table_parse_result.get(doc_file_name)[2]); // Doc verion.

    // Check that updating doc version triggers reparsing which now returns the correct sample because the doc was fixed earlier.. 
    dst_message = new Object();
    active_doc.version = 2;
    rainbow_utils.sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result);
    assert.equal(dst_message.actual_start_record, 11);
    assert.deepEqual([['l1', 'l2'], ['m1', 'm2']], dst_message.preview_records);
    assert.equal(dst_message.preview_sampling_error, undefined);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2'], ['d1', 'd2'], ['e1', 'e2'], ['f1', 'f2'], ['g1', 'g2'], ['h1', 'h2'], ['i1', 'i2'], ['j1', 'j2'], ['k1', 'k2'], ['l1', 'l2'], ['m1', 'm2'], ['n1', 'n2'], ['o1', 'o2']], cached_table_parse_result.get(doc_file_name)[0]);
    assert.equal(undefined, cached_table_parse_result.get(doc_file_name)[1]); // First failed line.
    assert.equal(2, cached_table_parse_result.get(doc_file_name)[2]); // Doc verion.
}


function test_show_lint_status_bar_button() {
    let [extension_context, file_path, language_id, fields_info, first_defective_line, first_trailing_space_line] = [null, null, null, null, null, null];

    // Test "is processing" display status.
    extension_context = {lint_results: new Map()};
    file_path = 'fake_path.txt';
    language_id = 'fake_csv_language_id';
    lint_cache_key = `${file_path}.${language_id}`;
    extension_context.lint_results.set(lint_cache_key, {is_processing: true, is_ok: true}); // Adding `is_ok` to test that it has no affect.
    rainbow_utils.show_lint_status_bar_button(vscode_test_double, extension_context, file_path, language_id);
    assert.equal(extension_context.lint_status_bar_button.is_visible, true);
    assert.equal(extension_context.lint_status_bar_button.tooltip, 'Processing\nClick to recheck');

    // Test that missing cache key entry doesn't create a new item.
    extension_context = {lint_results: new Map()};
    file_path = 'fake_path.txt';
    language_id = 'fake_csv_language_id';
    lint_cache_key = `${file_path}.${language_id}.bad`;
    extension_context.lint_results.set(lint_cache_key, {is_processing: true});
    rainbow_utils.show_lint_status_bar_button(vscode_test_double, extension_context, file_path, language_id);
    assert.equal(extension_context.lint_status_bar_button, undefined);

    // First defective line test. First trailing space line and inconsistent fields info should have no effect on the result.
    extension_context = {lint_results: new Map()};
    first_defective_line = 10;
    first_trailing_space_line = 5;
    fields_info = new Map([[2, 0], [3, 2]]);
    file_path = 'fake_path.txt';
    language_id = 'fake_csv_language_id';
    lint_cache_key = `${file_path}.${language_id}`;
    extension_context.lint_results.set(lint_cache_key, {first_defective_line: first_defective_line, fields_info: fields_info, first_trailing_space_line: first_trailing_space_line});
    rainbow_utils.show_lint_status_bar_button(vscode_test_double, extension_context, file_path, language_id);
    assert.equal(extension_context.lint_status_bar_button.is_visible, true);
    assert.equal(extension_context.lint_status_bar_button.tooltip, 'Error. Line 10 has formatting error: double quote chars are not consistent\nClick to recheck');

    // Inconsistent fields info test. First trailing space line should have no effect on the result.
    extension_context = {lint_results: new Map()};
    first_trailing_space_line = 5;
    fields_info = new Map([[2, 0], [1, 10], [4, 15], [3, 2]]);
    file_path = 'fake_path.txt';
    language_id = 'fake_csv_language_id';
    lint_cache_key = `${file_path}.${language_id}`;
    extension_context.lint_results.set(lint_cache_key, {fields_info: fields_info, first_trailing_space_line: first_trailing_space_line});
    rainbow_utils.show_lint_status_bar_button(vscode_test_double, extension_context, file_path, language_id);
    assert.equal(extension_context.lint_status_bar_button.is_visible, true);
    assert.equal(extension_context.lint_status_bar_button.tooltip, 'Error. Number of fields is not consistent: e.g. record 1 has 2 fields, and record 3 has 3 fields\nClick to recheck');

    // Test first trailing space line.
    extension_context = {lint_results: new Map()};
    first_trailing_space_line = 0; // Even zero line should trigger the warning - test against dumb `!first_trailing_space_line` check.
    file_path = 'fake_path.txt';
    language_id = 'fake_csv_language_id';
    lint_cache_key = `${file_path}.${language_id}`;
    extension_context.lint_results.set(lint_cache_key, {first_trailing_space_line: first_trailing_space_line, is_ok: true});
    rainbow_utils.show_lint_status_bar_button(vscode_test_double, extension_context, file_path, language_id);
    assert.equal(extension_context.lint_status_bar_button.is_visible, true);
    assert.equal(extension_context.lint_status_bar_button.tooltip, 'Leading/Trailing spaces detected: e.g. at line 1. Run "Shrink" command to remove them\nClick to recheck');

    // Test OK lint status - no errors/warnings.
    extension_context = {lint_results: new Map()};
    file_path = 'fake_path.txt';
    language_id = 'fake_csv_language_id';
    lint_cache_key = `${file_path}.${language_id}`;
    extension_context.lint_results.set(lint_cache_key, {is_ok: true});
    rainbow_utils.show_lint_status_bar_button(vscode_test_double, extension_context, file_path, language_id);
    assert.equal(extension_context.lint_status_bar_button.is_visible, true);
    assert.equal(extension_context.lint_status_bar_button.tooltip, 'OK\nClick to recheck');
}


function test_get_cursor_position_info() {
    let [doc_lines, active_doc, delim, policy, comment_prefix, position, position_info] = [null, null, null, null, null, null, null];

    // Basic test.
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1,c2', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'simple';
    comment_prefix = '#';
    position = new VscodePositionTestDouble(/*line=*/3, /*character=*/3);
    position_info = rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, position);
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, position_info);

    // Delim character maps to preceeding field.
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1,c2', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'simple';
    comment_prefix = '#';
    position = new VscodePositionTestDouble(/*line=*/3, /*character=*/2);
    position_info = rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, position);
    assert.deepEqual({column_number: 0, total_columns: 2, split_warning: false}, position_info);

    // Basic test, comment
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1,c2', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'simple';
    comment_prefix = '#';
    position = new VscodePositionTestDouble(/*line=*/2, /*character=*/5);
    position_info = rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, position);
    assert.deepEqual({is_comment: true}, position_info);

    // Column info for the last character in line.
    doc_lines = ['a1,a2', 'b1,b2', '#comment', 'c1,c2', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'simple';
    comment_prefix = '#';
    position = new VscodePositionTestDouble(/*line=*/3, /*character=*/4);
    position_info = rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, position);
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, position_info);

    // Multicharacter separator test - critical locations across field boundaries.
    doc_lines = ['a1@@@a2@@@a3', 'b1@@@b2@@@b3', '#comment', 'c1@@@c2@@@c3', 'd1@@@d2@@@d3'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = '@@@';
    policy = 'simple';
    comment_prefix = '#';
    assert.deepEqual({column_number: 0, total_columns: 3, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/4)));
    assert.deepEqual({column_number: 1, total_columns: 3, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/5)));
    assert.deepEqual({column_number: 1, total_columns: 3, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/9)));
    assert.deepEqual({column_number: 2, total_columns: 3, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/10)));

    // Column info for whitespace policy.
    doc_lines = ['a1  a2 ', 'b1    b2', '$$comment', '$c1  c2  ', 'd1   d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ' ';
    policy = 'whitespace';
    comment_prefix = '$$';
    assert.deepEqual({column_number: 0, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/0)));
    assert.deepEqual({column_number: 0, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/4)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/5)));
    assert.deepEqual({is_comment: true}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/2, /*character=*/6)));

    // Test with quoted policy and split warning.
    doc_lines = ['a1,a2', '$b1,"b2', '$$comment', '"c1,""c1""",c2', 'd1,d2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'quoted';
    comment_prefix = '$$';
    assert.deepEqual({column_number: 0, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/11)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/12)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: true}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/1, /*character=*/4)));
    assert.deepEqual({is_comment: true}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/2, /*character=*/6)));

    // Quoted RFC policy test.
    doc_lines = ['a1,a2', '#comment', 'b1,"b2', '#not a ""comment"", inside multiline field!', 'd1,d2"', 'e1,"e2,e2"', 'f1,"f2'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'quoted_rfc';
    comment_prefix = '#';
    assert.deepEqual({is_comment: true}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/1, /*character=*/6)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/6)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/4, /*character=*/5)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/5, /*character=*/3)));
    assert.equal(null, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/6, /*character=*/1)));
    assert.equal(null, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/6, /*character=*/3)));
}



function test_all() {
    test_align_stats();
    test_field_align();
    test_adjust_column_stats();
    test_parse_document_records();
    test_parse_document_range_rfc();
    test_is_opening_rfc_line();
    test_sample_preview_records_from_context();
    test_show_lint_status_bar_button();
    test_get_cursor_position_info();
}

exports.test_all = test_all;
exports.VscodePositionTestDouble = VscodePositionTestDouble;
exports.VscodeRangeTestDouble = VscodeRangeTestDouble;
exports.VscodeDocumentTestDouble = VscodeDocumentTestDouble;
exports.vscode_test_double = vscode_test_double;
