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


function test_record_sampling() {
    let fields_info = new Map([[2, 1], [10, 5]]);
    assert.deepEqual([1, 2, 5, 10], rainbow_utils.sample_first_two_inconsistent_records(fields_info));

    fields_info = new Map([[2, 1], [10, 5], [1, 6]]);
    assert.deepEqual([1, 2, 5, 10], rainbow_utils.sample_first_two_inconsistent_records(fields_info));

    fields_info = new Map([[2, 1], [10, 5], [1, 6], [3, 200], [4, 110]]);
    assert.deepEqual([1, 2, 5, 10], rainbow_utils.sample_first_two_inconsistent_records(fields_info));

    fields_info = new Map([[2, 1], [10, 5], [1, 6], [3, 200], [8, 0]]);
    assert.deepEqual([0, 8, 1, 2], rainbow_utils.sample_first_two_inconsistent_records(fields_info));
}


function test_parse_document_records() {
    let [doc_lines, active_doc, comment_prefix, delim, policy] = [null, null, null, null, null];
    let [records, fields_info, first_defective_line, first_trailing_space_line] = [null, null, null, null];

    // Simple test with single-field records.
    doc_lines = ['aaa', 'bbb', 'ccc'];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    [records, fields_info, first_defective_line, first_trailing_space_line] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['aaa'], ['bbb'], ['ccc']], records);
    assert.deepEqual([[1, 0]], Array.from(fields_info.entries()));
    assert.equal(null, first_defective_line);
    assert.equal(null, first_trailing_space_line);

    // FIXME add more unit tests.
}


function test_all() {
    test_align_stats();
    test_field_align();
    test_adjust_column_stats();
    test_record_sampling();
    test_parse_document_records();
}

exports.test_all = test_all;

