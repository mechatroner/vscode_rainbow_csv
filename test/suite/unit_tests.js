const assert = require('assert');
const rainbow_utils = require('../../rainbow_utils.js');
const fast_load_utils = require('../../fast_load_utils.js');


class VscodePositionTestDouble {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class VscodeSelectionTestDouble {
    constructor(anchor, active) {
        this.anchor = anchor;
        this.active = active;
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

class UriTestDouble {
    constructor(scheme) {
        this.scheme = scheme;
    }
}

class VscodeDocumentTestDouble {
    constructor(lines_buffer, fileName='TestDouble.txt', language_id='plaintext', scheme='file') {
        this.lines_buffer = lines_buffer;
        this.lineCount = lines_buffer.length;
        this.fileName = fileName;
        this.version = 1;
        this.languageId = language_id;
        this.uri = new UriTestDouble(scheme);
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


class InlayHintTestDouble {
    constructor(position, label) {
        this.position = position;
        this.label = label;
    }
}


function create_status_bar_item_test_double(_alignment) {
    return new VscodeStatusBarItemTestDouble();
}


function set_text_document_language_test_double(target_document, language_id) {
    target_document.languageId = language_id;
    return target_document;
}


let vscode_test_double = {
    Range: VscodeRangeTestDouble, 
    'window': {'createStatusBarItem': create_status_bar_item_test_double}, 
    StatusBarAlignment: {'Left': null}, 
    languages: {'setTextDocumentLanguage': set_text_document_language_test_double}, 
    Position: VscodePositionTestDouble, 
    InlayHint: InlayHintTestDouble,
    Selection: VscodeSelectionTestDouble
};


// Helper testing function to adjust column stats.
function raw_column_stats_to_typed(raw_stat) {
    let enable_double_width_alignment = raw_stat.hasOwnProperty('enable_double_width_alignment') ? raw_stat.enable_double_width_alignment : true;
    let typed_stat = new rainbow_utils.ColumnStat(enable_double_width_alignment);
    if (raw_stat.max_int_length >= 0) {
        typed_stat.max_int_length = raw_stat.max_int_length;
        typed_stat.max_fractional_length = raw_stat.max_fractional_length;
    } else {
        typed_stat.mark_non_numeric();
    }
    typed_stat.max_total_length = raw_stat.max_total_length;
    if (raw_stat.hasOwnProperty('has_wide_chars')) {
        typed_stat.has_wide_chars = raw_stat.has_wide_chars;
        // TODO consider adding a test where only_ascii is false and has_wide_chars is true.
        typed_stat.only_ascii = !raw_stat.has_wide_chars;
    }
    if (raw_stat.hasOwnProperty('only_ascii')) {
        typed_stat.only_ascii = raw_stat.only_ascii;
    }
    return typed_stat;
}


// Helper testing function to adjust column stats.
function column_stats_helper(column_stats_raw_objects) {
    let result = [];
    for (let raw_stat of column_stats_raw_objects) {
        result.push(raw_column_stats_to_typed(raw_stat));
    }
    return result;
}


function test_calc_column_stats_for_fragment() {
    let [doc_lines, active_doc, comment_prefix, delim, policy, range, double_width_alignment] = [null, null, null, null, null, null, null];
    let [table_ranges, all_columns_stats] = [null, null];

    // Simple test case with comments.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#foo,bar',
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    double_width_alignment = true;
    range = new vscode_test_double.Range(1, 0, 3, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    all_columns_stats = rainbow_utils.calc_column_stats_for_fragment(table_ranges, double_width_alignment);
    expected_column_stats = column_stats_helper([
        {max_total_length: 2, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 2, max_int_length: -1, max_fractional_length: -1}]);
    assert.deepEqual(expected_column_stats, all_columns_stats);
}


function test_generate_inlay_hints() {
    let [doc_lines, active_doc, comment_prefix, delim, policy, range, double_width_alignment] = [null, null, null, null, null, null, null];
    let [table_ranges, all_columns_stats, inlay_hints, expected_inlay_hints] = [null, null, null, null];
    let alignment_char = null;
    let enable_vertical_grid = false; // TODO add a test with true

    // Simple test case.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c11,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    alignment_char = '·';
    double_width_alignment = true;
    enable_vertical_grid = false;
    range = new vscode_test_double.Range(1, 0, 3, 0);
    visible_range = new vscode_test_double.Range(0, 0, 100, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/false, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    all_columns_stats = rainbow_utils.calc_column_stats_for_fragment(table_ranges, double_width_alignment);
    inlay_hints = rainbow_utils.generate_inlay_hints(vscode_test_double, visible_range, table_ranges, all_columns_stats, delim.length, alignment_char, enable_vertical_grid);
    expected_inlay_hints = [
        new InlayHintTestDouble(new VscodePositionTestDouble(1, 2), /*label=*/'·'),
        new InlayHintTestDouble(new VscodePositionTestDouble(1, 3), /*label=*/'·'),
        new InlayHintTestDouble(new VscodePositionTestDouble(2, 4), /*label=*/'·')];
    assert.deepEqual(expected_inlay_hints, inlay_hints);

    // Skip all comments - empty result.
    doc_lines = [
        'a1,a2', 
        '#b1,b2', 
        '#c11,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = "#";
    delim = ',';
    policy = 'simple';
    alignment_char = ' ';
    double_width_alignment = true;
    enable_vertical_grid = false;
    range = new vscode_test_double.Range(1, 0, 3, 0);
    visible_range = new vscode_test_double.Range(0, 0, 100, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/false, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    all_columns_stats = rainbow_utils.calc_column_stats_for_fragment(table_ranges, double_width_alignment);
    inlay_hints = rainbow_utils.generate_inlay_hints(vscode_test_double, visible_range, table_ranges, all_columns_stats, delim.length, alignment_char, enable_vertical_grid);
    expected_inlay_hints = [];
    assert.deepEqual(expected_inlay_hints, inlay_hints);

    // Spaces both before and after.
    doc_lines = [
        '10,a2', 
        '5,b2', 
        '5.12,c2', 
        '200,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    alignment_char = ' ';
    double_width_alignment = true;
    enable_vertical_grid = false;
    range = new vscode_test_double.Range(0, 0, 10, 0);
    visible_range = new vscode_test_double.Range(0, 0, 100, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/false, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    all_columns_stats = rainbow_utils.calc_column_stats_for_fragment(table_ranges, double_width_alignment);
    inlay_hints = rainbow_utils.generate_inlay_hints(vscode_test_double, visible_range, table_ranges, all_columns_stats, delim.length, alignment_char, enable_vertical_grid);
    expected_inlay_hints = [
        /*before:*/new InlayHintTestDouble(new VscodePositionTestDouble(0, 0), /*label=*/' '), /*after:*/new InlayHintTestDouble(new VscodePositionTestDouble(0, 2), /*label=*/'   '), /*second_col:*/new InlayHintTestDouble(new VscodePositionTestDouble(0, 3), /*label=*/' '),
        /*before:*/new InlayHintTestDouble(new VscodePositionTestDouble(1, 0), /*label=*/'  '), /*after:*/new InlayHintTestDouble(new VscodePositionTestDouble(1, 1), /*label=*/'   '), /*second_col:*/new InlayHintTestDouble(new VscodePositionTestDouble(1, 2), /*label=*/' '),
        /*before:*/new InlayHintTestDouble(new VscodePositionTestDouble(2, 0), /*label=*/'  '), /*second_col:*/new InlayHintTestDouble(new VscodePositionTestDouble(2, 5), /*label=*/' '),
        /*empty allignment before, so we only have after:*/new InlayHintTestDouble(new VscodePositionTestDouble(3, 3), /*label=*/'   '), /*second_col:*/new InlayHintTestDouble(new VscodePositionTestDouble(3, 4), /*label=*/' ')];
    assert.deepEqual(inlay_hints, expected_inlay_hints);
}

function test_align_stats() {
    let field = null;
    let field_segments = null;
    let is_first_line = null;
    let column_stats = null;
    let expected_column_stats = null;

    // Previous fields are numbers but the current one is not - mark the column as non-numeric.
    field = 'foobar';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 5, max_int_length: 2, max_fractional_length: 3, has_wide_chars: false});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 6, max_int_length: -1, max_fractional_length: -1, has_wide_chars: false});
    assert.deepEqual(expected_column_stats, column_stats);

    // The field is non-numeric but it is at the first line so could be a header - do not mark the column as non-numeric just yet.
    field = 'foobar';
    field_segments = [field];
    is_first_line = 1;
    column_stats = raw_column_stats_to_typed({max_total_length: 0, max_int_length: 0, max_fractional_length: 0});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 6, max_int_length: 0, max_fractional_length: 0, has_wide_chars: false});
    assert.deepEqual(expected_column_stats, column_stats);

    // The field is a number but the column is already marked as non-numeric so we just update the max string width.
    field = '100000';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 2, max_int_length: -1, max_fractional_length: -1});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 6, max_int_length: -1, max_fractional_length: -1, has_wide_chars: false});
    assert.deepEqual(expected_column_stats, column_stats);

    // Empty field should not mark a potentially numeric column as non-numeric.
    field = '';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 5, max_int_length: 2, max_fractional_length: 3});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 5, max_int_length: 2, max_fractional_length: 3, has_wide_chars: false});
    assert.deepEqual(expected_column_stats, column_stats);

    // The field doesn't change stats because all of 3 components are smaller than the current maximums.
    field = '100.3';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 7, max_int_length: 4, max_fractional_length: 3, has_wide_chars: false});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 7, max_int_length: 4, max_fractional_length: 3, has_wide_chars: false});
    assert.deepEqual(expected_column_stats, column_stats);

    // Integer update example.
    field = '100000';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 5, max_int_length: 2, max_fractional_length: 3});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 6, max_int_length: 6, max_fractional_length: 3, has_wide_chars: false});
    assert.deepEqual(expected_column_stats, column_stats);

    // Float update example.
    field = '1000.23';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 3, max_int_length: 3, max_fractional_length: 0});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 7, max_int_length: 4, max_fractional_length: 3, has_wide_chars: false});
    assert.deepEqual(expected_column_stats, column_stats);

    // Double-width chars and enable_double_width_alignment set to "true"
    field = '编号';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 1, max_int_length: -1, max_fractional_length: -1});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 4, max_int_length: -1, max_fractional_length: -1, has_wide_chars: true});
    assert.deepEqual(expected_column_stats, column_stats);

    // Double-width chars and enable_double_width_alignment set to "true", has_wide_chars doesn't change i.e. remains 'true' even though field doesn't contain wide chars.
    field = 'foobar';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 1, max_int_length: -1, max_fractional_length: -1, has_wide_chars: true});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 6, max_int_length: -1, max_fractional_length: -1, has_wide_chars: true});
    assert.deepEqual(expected_column_stats, column_stats);

    // Double-width chars and enable_double_width_alignment set to "false"
    field = '编号';
    field_segments = [field];
    is_first_line = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 1, max_int_length: -1, max_fractional_length: -1, enable_double_width_alignment: false});
    column_stats.update_from_field(field_segments, is_first_line);
    expected_column_stats = raw_column_stats_to_typed({max_total_length: 2, max_int_length: -1, max_fractional_length: -1, enable_double_width_alignment: false});
    assert.deepEqual(expected_column_stats, column_stats);
}


function test_calc_column_stats() {
    let [doc_lines, active_doc, delim, policy, comment_prefix] = [null, null, null, null, null];
    let [column_stats, expected_column_stats, first_failed_line, records, comments] = [null, null, null, null, null];

    // A basic rfc test.
    doc_lines = [
        '# commment line', 
        '1a,"1b', 
        '1b,""1b"",1b', 
        '1b",1c',
        '2a,2bbb,2cc', 
        ''
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    assert.deepEqual([{record_num: 0, comment_text: '# commment line'}, {record_num: 2, comment_text: ''}], comments);
    assert.deepEqual(null, first_failed_line);
    expected_column_stats = column_stats_helper([
        {max_total_length: 2, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 12, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 3, max_int_length: -1, max_fractional_length: -1}]);
    assert.deepEqual(expected_column_stats, column_stats);

    // Inconsistent num fields.
    doc_lines = [
        '1a,1b', 
        '2aa', 
        '3a,3b,3c'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    assert.deepEqual([], comments);
    assert.deepEqual(null, first_failed_line);
    expected_column_stats = column_stats_helper([
        {max_total_length: 3, max_int_length: -1, max_fractional_length: -1, has_wide_chars: false},
        {max_total_length: 2, max_int_length: -1, max_fractional_length: -1, has_wide_chars: false},
        {max_total_length: 2, max_int_length: -1, max_fractional_length: -1, has_wide_chars: false}])
    assert.deepEqual(expected_column_stats, column_stats);

    // Defective line.
    doc_lines = [
        '1a,1b', 
        '2a"a', 
        '3a,3b,3c'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    assert.deepEqual(2, first_failed_line);
    assert.deepEqual(null, column_stats);
    assert.deepEqual(null, records);

    // First line non-numeric.
    doc_lines = [
        'type,weight', 
        'car,100', 
        'ship,  20000'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    assert.deepEqual([], comments);
    assert.deepEqual(null, first_failed_line);
    expected_column_stats = column_stats_helper([
        {max_total_length: 4, max_int_length: -1, max_fractional_length: -1, has_wide_chars: false},
        {max_total_length: 6, max_int_length: 5, max_fractional_length: 0, has_wide_chars: false}])
    assert.deepEqual(expected_column_stats, column_stats);

    // Numbers on different lines.
    // Currently in this case we don't report second column as numeric, but this is more-or-less an arbitrary decission.
    doc_lines = [
        'car,100', 
        'ship,"20000', 
        '300"'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    assert.deepEqual([], comments);
    assert.deepEqual(null, first_failed_line);
    expected_column_stats = column_stats_helper([
        {max_total_length: 4, max_int_length: -1, max_fractional_length: -1, has_wide_chars: false}, 
        {max_total_length: 6, max_int_length: -1, max_fractional_length: -1, has_wide_chars: false}]);
    assert.deepEqual(expected_column_stats, column_stats);
}


function test_rfc_field_align() {
    let [field, is_first_line, column_stats, aligned_field, is_field_segment] = [null, null, null, null, null, null];
    let column_offsets = null;

    // Align non-field segment in non-numeric non-last column.
    field = 'foobar';
    is_first_line = 0;
    is_field_segment = false;
    column_stats = [{max_total_length: 5, max_int_length: -1, max_fractional_length: -1}, {max_total_length: 10, max_int_length: -1, max_fractional_length: -1}];
    column_stats = column_stats_helper(column_stats)
    column_offsets = rainbow_utils.calculate_column_offsets(column_stats, /*delim_length=*/1);
    aligned_field = rainbow_utils.rfc_align_field(field, is_first_line, column_stats[1], column_offsets[1], is_field_segment, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual(' foobar    ', aligned_field);

    field = 'foobar';
    is_first_line = 0;
    is_field_segment = false;
    column_stats = [{max_total_length: 5, max_int_length: -1, max_fractional_length: -1}, {max_total_length: 10, max_int_length: -1, max_fractional_length: -1}];
    column_stats = column_stats_helper(column_stats)
    column_offsets = rainbow_utils.calculate_column_offsets(column_stats, /*delim_length=*/1);
    aligned_field = rainbow_utils.rfc_align_field(field, is_first_line, column_stats[1], column_offsets[1], is_field_segment, /*is_first_in_line=*/true, /*is_last_in_line=*/false);
    assert.deepEqual('foobar    ', aligned_field);

    // Align field segment in non-numeric non-last column.
    field = 'foobar';
    is_first_line = 0;
    is_field_segment = true;
    column_stats = [{max_total_length: 5, max_int_length: -1, max_fractional_length: -1}, {max_total_length: 10, max_int_length: -1, max_fractional_length: -1}];
    column_stats = column_stats_helper(column_stats)
    column_offsets = rainbow_utils.calculate_column_offsets(column_stats, /*delim_length=*/1);
    aligned_field = rainbow_utils.rfc_align_field(field, is_first_line, column_stats[1], column_offsets[1], is_field_segment, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual('        foobar    ', aligned_field);

    // Align non-field segment in non-numeric last column.
    field = 'foobar';
    is_first_line = 0;
    is_field_segment = false;
    column_stats = [{max_total_length: 5, max_int_length: -1, max_fractional_length: -1}, {max_total_length: 10, max_int_length: -1, max_fractional_length: -1}];
    column_stats = column_stats_helper(column_stats)
    column_offsets = rainbow_utils.calculate_column_offsets(column_stats, /*delim_length=*/1);
    aligned_field = rainbow_utils.rfc_align_field(field, is_first_line, column_stats[1], column_offsets[1], is_field_segment, /*is_first_in_line=*/false, /*is_last_in_line=*/true);
    assert.deepEqual(' foobar', aligned_field);

    // Align field segment in non-numeric last column.
    field = 'foobar';
    is_first_line = 0;
    is_field_segment = true;
    column_stats = [{max_total_length: 5, max_int_length: -1, max_fractional_length: -1}, {max_total_length: 10, max_int_length: -1, max_fractional_length: -1}];
    column_stats = column_stats_helper(column_stats)
    column_offsets = rainbow_utils.calculate_column_offsets(column_stats, /*delim_length=*/1);
    aligned_field = rainbow_utils.rfc_align_field(field, is_first_line, column_stats[1], column_offsets[1], is_field_segment, /*is_first_in_line=*/false, /*is_last_in_line=*/true);
    assert.deepEqual('        foobar', aligned_field);
}


function align_field(field, is_first_record, column_stat, is_first_in_line, is_last_in_line) {
    let [num_before, num_after] = column_stat.evaluate_align_field(field, is_first_record, is_first_in_line, is_last_in_line);
    return ' '.repeat(num_before) + field + ' '.repeat(num_after);
}


function test_reconcile_single() {
    let [column_stats_local, column_stats_global] = [null, null];

    column_stats_local = raw_column_stats_to_typed({max_total_length: 5, max_int_length: -1, max_fractional_length: -1});
    column_stats_global = raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1});
    column_stats_local.reconcile(column_stats_global);
    assert.deepEqual(raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1}), column_stats_local);

    column_stats_local = raw_column_stats_to_typed({max_total_length: 5, max_int_length: -1, max_fractional_length: -1});
    column_stats_global = raw_column_stats_to_typed({max_total_length: 10, max_int_length: 3, max_fractional_length: 4});
    column_stats_local.reconcile(column_stats_global);
    assert.deepEqual(raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1}), column_stats_local);

    column_stats_local= raw_column_stats_to_typed({max_total_length: 10, max_int_length: 3, max_fractional_length: 4});
    column_stats_global = raw_column_stats_to_typed({max_total_length: 5, max_int_length: -1, max_fractional_length: -1});
    column_stats_local.reconcile(column_stats_global);
    assert.deepEqual(raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1}), column_stats_local);

    column_stats_local= raw_column_stats_to_typed({max_total_length: 10, max_int_length: 3, max_fractional_length: 4});
    column_stats_global = raw_column_stats_to_typed({max_total_length: 12, max_int_length: 5, max_fractional_length: 6});
    column_stats_local.reconcile(column_stats_global);
    assert.deepEqual(raw_column_stats_to_typed({max_total_length: 12, max_int_length: 5, max_fractional_length: 6}), column_stats_local);

    column_stats_local= raw_column_stats_to_typed({max_total_length: 10, max_int_length: 3, max_fractional_length: 4, only_ascii: true, has_wide_chars: false});
    column_stats_global = raw_column_stats_to_typed({max_total_length: 12, max_int_length: 5, max_fractional_length: 6, only_ascii: false, has_wide_chars: true});
    column_stats_local.reconcile(column_stats_global);
    assert.deepEqual(raw_column_stats_to_typed({max_total_length: 12, max_int_length: 5, max_fractional_length: 6, only_ascii: false, has_wide_chars: true}), column_stats_local);
}


function test_offsets_calculation() {
    let column_stats = null;
    let offsets = null;
    let expected_offsets = null;

    column_stats = [];
    expected_offsets = [];
    offsets = rainbow_utils.calculate_column_offsets(column_stats, /*delim_length=*/1);
    assert.deepEqual(expected_offsets, offsets);

    column_stats = [
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1}
    ];
    expected_offsets = [0];
    column_stats = column_stats_helper(column_stats);
    offsets = rainbow_utils.calculate_column_offsets(column_stats, /*delim_length=*/1);
    assert.deepEqual(expected_offsets, offsets);

    column_stats = [
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 20, max_int_length: -1, max_fractional_length: -1}
    ];
    expected_offsets = [0, 8, 21];
    column_stats = column_stats_helper(column_stats);
    offsets = rainbow_utils.calculate_column_offsets(column_stats, /*delim_length=*/2);
    assert.deepEqual(expected_offsets, offsets);
}


function test_adjusted_length() {
    let column_stats = null;

    column_stats = raw_column_stats_to_typed({max_total_length: 7, max_int_length: 4, max_fractional_length: 4});
    assert.deepEqual(8, column_stats.get_adjusted_total_length());
    assert.deepEqual(4, column_stats.get_adjusted_int_length());

    column_stats = raw_column_stats_to_typed({max_total_length: 8, max_int_length: 3, max_fractional_length: 4});
    assert.deepEqual(8, column_stats.get_adjusted_total_length());
    assert.deepEqual(4, column_stats.get_adjusted_int_length());
}


function test_reconcile_multiple() {
    let [column_stats_local, column_stats_global, expected_reconciled_column_stats] = [null, null, null];

    column_stats_local = [
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1}
    ];
    column_stats_global = [
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1}
    ];
    expected_reconciled_column_stats = [
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1}
    ];
    column_stats_local = column_stats_helper(column_stats_local)
    column_stats_global = column_stats_helper(column_stats_global)
    expected_reconciled_column_stats = column_stats_helper(expected_reconciled_column_stats);
    rainbow_utils.reconcile_whole_doc_and_local_column_stats(column_stats_global, column_stats_local);
    assert.deepEqual(expected_reconciled_column_stats, column_stats_local);

    column_stats_local = [
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1}
    ];
    column_stats_global = [
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1},
    ];
    expected_reconciled_column_stats = [
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1}
    ];
    column_stats_local = column_stats_helper(column_stats_local)
    column_stats_global = column_stats_helper(column_stats_global)
    expected_reconciled_column_stats = column_stats_helper(expected_reconciled_column_stats);
    rainbow_utils.reconcile_whole_doc_and_local_column_stats(column_stats_global, column_stats_local);
    assert.deepEqual(expected_reconciled_column_stats, column_stats_local);

    column_stats_local = [
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1},
    ];
    column_stats_global = [
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1}
    ];
    expected_reconciled_column_stats = [
        {max_total_length: 10, max_int_length: -1, max_fractional_length: -1},
        {max_total_length: 5, max_int_length: -1, max_fractional_length: -1}
    ];
    column_stats_local = column_stats_helper(column_stats_local)
    column_stats_global = column_stats_helper(column_stats_global)
    expected_reconciled_column_stats = column_stats_helper(expected_reconciled_column_stats);
    rainbow_utils.reconcile_whole_doc_and_local_column_stats(column_stats_global, column_stats_local);
    assert.deepEqual(expected_reconciled_column_stats, column_stats_local);
}


function test_field_align() {
    let field = null;
    let is_first_record = null;
    let column_stats = null;
    let aligned_field = null;

    // Align field in non-numeric non-last column.
    field = 'foobar';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual(' foobar    ', aligned_field);

    field = 'foobar';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/true, /*is_last_in_line=*/false);
    assert.deepEqual('foobar    ', aligned_field);

    // Align field in non-numeric last column.
    field = 'foobar';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/true);
    assert.deepEqual(' foobar', aligned_field);

    // Align non-numeric first line (potentially header) field in numeric column.
    field = 'foobar';
    is_first_record = 1;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: 4, max_fractional_length: 6});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual(' foobar    ', aligned_field);

    // Align numeric first line (potentially header) field in numeric column.
    field = '10.1';
    is_first_record = 1;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: 4, max_fractional_length: 6});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual('   10.1    ', aligned_field);

    // Align numeric field in non-numeric column (first line).
    field = '10.1';
    is_first_record = 1;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual(' 10.1      ', aligned_field);

    // Align numeric field in non-numeric column (not first line).
    field = '10.1';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: -1, max_fractional_length: -1});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual(' 10.1      ', aligned_field);

    // Align numeric float in numeric non-last column.
    field = '10.1';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: 4, max_fractional_length: 6});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual('   10.1    ', aligned_field);

    // Align numeric integer in numeric non-last column.
    field = '1000';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 10, max_int_length: 4, max_fractional_length: 6});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual(' 1000      ', aligned_field);

    // Align numeric integer in numeric (integer) column.
    field = '1000';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 4, max_int_length: 4, max_fractional_length: 0});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual(' 1000', aligned_field);

    // Align numeric integer in numeric (integer) column dominated by header width.
    field = '1000';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 6, max_int_length: 4, max_fractional_length: 0});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual('   1000', aligned_field);

    // Align numeric float in numeric column dominated by header width.
    field = '10.1';
    is_first_record = 0;
    column_stats = raw_column_stats_to_typed({max_total_length: 12, max_int_length: 4, max_fractional_length: 6});
    aligned_field = align_field(field, is_first_record, column_stats, /*is_first_in_line=*/false, /*is_last_in_line=*/false);
    assert.deepEqual('     10.1    ', aligned_field);
}


function test_parse_document_records() {
    let [doc_lines, active_doc, comment_prefix, delim, policy] = [null, null, null, null, null];
    let [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = [null, null, null, null, null, null];

    // Simple test with single-field records and max_records_to_parse set to a very big number.
    doc_lines = [
        'aaa', 
        'bbb', 
        'ccc'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/1000, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['aaa'], ['bbb'], ['ccc']], records);
    assert.deepEqual([[1, 0]], Array.from(fields_info.entries()));
    assert.deepEqual([], comments);
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, null);
    assert.equal(num_records_parsed, records.length);

    // Simple test with two-field records and a comment and a trailing space line.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1 ,c2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1 ', 'c2']], records);
    assert.deepEqual([[2, 0]], Array.from(fields_info.entries()));
    assert.deepEqual([{record_num: 2, comment_text: '#comment'}], comments);
    assert.equal(first_defective_line, null);
    // The first trailing space line is line 3 (0-based) because the comment line also counts for a document line.
    assert.equal(first_trailing_space_line, 3);

    // Test whitespace trimming.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1 ,c2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/true, /*min_num_fields_for_autodetection=*/-1, /*trim_whitespaces=*/true);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']], records);
    assert.deepEqual([[2, 0]], Array.from(fields_info.entries()));
    assert.deepEqual([{record_num: 2, comment_text: '#comment'}], comments);
    assert.equal(first_defective_line, null);
    // The first trailing space line is line 3 (0-based) because the comment line also counts for a document line.
    assert.equal(first_trailing_space_line, 3);

    // Simple test with inconsistent records and trailing space.
    doc_lines = [
        'a1,a2 ', 
        'b1,b2', 
        '', 
        'c1', 
        'd3,d4,d5'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2 '], ['b1', 'b2'], [''], ['c1'], ['d3', 'd4', 'd5']], records);
    assert.deepEqual([[2, 0], [1, 2], [3, 4]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, 0);

    // Quoted policy, defective line 3, do not stop on warning.
    doc_lines = [
        'a1,a2', 
        '#"b1,b2', 
        '"b1,b2', 
        'c1', 
        'd3,d4,d5'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2'], ['"b1', 'b2'], ['c1'], ['d3', 'd4', 'd5']], records);
    assert.deepEqual([{record_num: 1, comment_text: '#"b1,b2'}], comments);
    assert.equal(first_defective_line, 2);
    assert.equal(first_trailing_space_line, null);

    // Quoted policy, defective line 3, stop on warning.
    doc_lines = [
        'a1,a2', 
        '#"b1,b2', 
        '"b1,b2', 
        'c1', 
        'd3,d4,d5'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2']], records);
    assert.deepEqual([{record_num: 1, comment_text: '#"b1,b2'}], comments);
    assert.equal(first_defective_line, 2);
    assert.equal(first_trailing_space_line, null);

    // Quoted rfc policy - no issues.
    doc_lines = [
        'a1,"a2', 
        'b1"",b2 ', 
        'c1,c2",c3', 
        '#d1,"', 
        '"e1,""e2,e3"', 
        'f1 ,f2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2\nb1",b2 \nc1,c2', 'c3'], ['e1,"e2,e3'], ['f1 ', 'f2']], records);
    assert.deepEqual([{record_num: 1, comment_text: '#d1,"'}], comments);
    assert.equal(first_defective_line, null);
    // Trailing spaces inside the fields do not count, so the first trailing space will be at line 5.
    assert.equal(first_trailing_space_line, 5);

    // Quoted rfc policy - stop on warning.
    doc_lines = [
        'a1,"a2', 
        'b1"",b2 ', 
        'c1,"c2,c3', 
        '#d1,"', 
        '"e1,""e2,e3"', 
        'f1 ,f2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/true);
    assert.deepEqual([], records);
    assert.deepEqual([], comments);
    assert.equal(first_defective_line, 0);

    // too few columns for autodetection
    doc_lines = [
        'a1', 
        'b1', 
        'c1'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/false, /*preserve_quotes_and_whitespaces=*/true, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
    assert.equal(null, records);
    assert.deepEqual([], comments);
    // Only one entry in fields_info because of the early stop because of min_num_fields_for_autodetection check.
    assert.deepEqual([[1, 0]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, null);

    // Autodetection - enough columns.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/false, /*preserve_quotes_and_whitespaces=*/true, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
    assert.equal(null, records);
    assert.deepEqual([[2, 0]], Array.from(fields_info.entries()));
    assert.equal(first_defective_line, null);
    assert.equal(first_trailing_space_line, null);

    // Autodetection - different number of columns - early stop.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2,c3', 
        'd1,d3'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/false, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/false, /*min_num_fields_for_autodetection=*/2);
    // Because of the early stop we don't parse the last 2 lines.
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2']], records);
    // Make sure that we have two entries in fields_info - callers check fields_info to find out if we have autodetection failure.
    assert.deepEqual([[2, 0], [3, 2]], Array.from(fields_info.entries()));

    // Max record to parse - no defective line.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '"c1,c2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted_rfc';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/2, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2']], records);
    // Although the third line is defective we don't detect it because of max_records_to_parse limitation.
    assert.equal(first_defective_line, null);

    // Max record to parse - defective line.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '"c1,c2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted_rfc';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/5, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2'], ['b1', 'b2']], records);
    // Although the third line is defective we don't detect it because of max_records_to_parse limitation.
    assert.equal(first_defective_line, 2);

    // Simple multichar separator, max_records_to_parse equals total number of records.
    doc_lines = [
        'a1#~#a2#~#a3', 
        'b1#~#b2#~#b3', 
        'c1#~#c2#~#c3'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = '#~#';
    policy = 'simple';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/3, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/false);
    assert.deepEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']], records);
    assert.equal(first_defective_line, null);

    // Whitespace policy, trailing spaces are impossible for this policy.
    doc_lines = [
        '  a1 a2    a3', 
        'b1     b2 b3  ', 
        '  c1    c2       c3  '
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ' ';
    policy = 'whitespace';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/3, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']], records);
    assert.equal(first_defective_line, null);
    // Although we have a lot of internal spaces, the first_trailing_space_line should be null because we use whitespace policy
    assert.equal(first_trailing_space_line, null);

    // Quoted rfc policy, preserve quotes.
    doc_lines = [
        'a1,"a2', 'b1"",b2 ', 
        'c1,c2",c3', '#d1,"', 
        '"e1,""e2,e3"', 
        'f1 ,f2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [records, num_records_parsed, fields_info, first_defective_line, first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/true, /*detect_trailing_spaces=*/true);
    assert.deepEqual([['a1', '"a2\nb1"",b2 \nc1,c2"', 'c3'], ['"e1,""e2,e3"'], ['f1 ', 'f2']], records);
    assert.deepEqual([{record_num: 1, comment_text: '#d1,"'}], comments);
    assert.equal(first_defective_line, null);
    // Trailing spaces inside the fields do not count, so the first trailing space will be at line 5.
    assert.equal(first_trailing_space_line, 5);
}


function line_range_to_triple(vscode_range) {
    assert.equal(vscode_range.start.line, vscode_range.end.line);
    return [vscode_range.start.line, vscode_range.start.character, vscode_range.end.character];
}

function convert_ranges_to_triples(table_ranges) {
    let table_comment_ranges = [];
    let table_record_ranges = [];
    for (let row_info of table_ranges) {
        if (row_info.comment_range !== null) {
            assert(row_info.record_ranges === null);
            table_comment_ranges.push(line_range_to_triple(row_info.comment_range));
        } else {
            assert(row_info.record_ranges !== null);
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


function test_parse_document_range_single_line() {
    let [doc_lines, active_doc, comment_prefix, delim, policy, range] = [null, null, null, null, null, null];
    let [table_ranges, table_comment_ranges, table_record_ranges] = [null, null, null];
    let [record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3] = [null, null, null, null];

    // Simple test case.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    range = new vscode_test_double.Range(1, 0, 3, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Simple test case without delim inclusion.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    range = new vscode_test_double.Range(1, 0, 3, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/false, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 2)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 2)], [fvr(2, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Test last line parsing.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    range = new vscode_test_double.Range(1, 0, 4, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(3, 0, 3)], [fvr(3, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Test a broken rfc line - should just skip over it.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,"c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'quoted';
    range = new vscode_test_double.Range(1, 0, 4, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_3 = [[fvr(3, 0, 3)], [fvr(3, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_3], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Test last empty line parsing - no effect.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2',
        ''
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    policy = 'simple';
    range = new vscode_test_double.Range(1, 0, 10, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, policy, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(3, 0, 3)], [fvr(3, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Test behind last line and before first line parsing with large margin.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        '#comment', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    range = new vscode_test_double.Range(0, 0, 5, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, policy, comment_prefix, range, /*custom_parsing_margin=*/100);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([fvr(3, 0, 8)], table_comment_ranges);

    // Test extension with the default margin.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        '#comment', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'simple';
    // The range covers only one line, but the default margin=50 should extend it to cover everything.
    range = new vscode_test_double.Range(2, 0, 2, 0);
    table_ranges = rainbow_utils.parse_document_range_single_line(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, policy, comment_prefix, range);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([fvr(3, 0, 8)], table_comment_ranges);
}


function test_parse_document_range_rfc() {
    let [doc_lines, active_doc, comment_prefix, delim, range] = [null, null, null, null, null];
    let [table_ranges, table_comment_ranges, table_record_ranges] = [null, null, null];
    let [record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3] = [null, null, null, null];

    // Simple test case.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 3, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Simple test case without delim inclusion.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 3, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/false, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 2)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 2)], [fvr(2, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Test last line parsing.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 4, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(3, 0, 3)], [fvr(3, 3, 5)]];
    assert.deepEqual([record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Test behind last line and before first line parsing with large margin.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        '#comment', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 5, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/100);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([fvr(3, 0, 8)], table_comment_ranges);

    // Test extension with the default margin.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        '#comment', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    // The range covers only one line, but the default margin=50 should extend it to cover everything.
    range = new vscode_test_double.Range(2, 0, 2, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 5)]];
    record_ranges_3 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2, record_ranges_3], table_record_ranges);
    assert.deepEqual([fvr(3, 0, 8)], table_comment_ranges);


    // Single record, 3 fields.
    doc_lines = [
        'a1,"a2', 
        'b1,b2', 
        'c1,c2', 
        'd1",d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = null;
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 4, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/100);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 6), fvr(1, 0, 5), fvr(2, 0, 5), fvr(3, 0, 4)], [fvr(3, 4, 6)]];
    assert.deepEqual([record_ranges_0], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Mixture of single line and multiline fields in a single record. Also a comment prefix in the middle of the field which should not count.
    doc_lines = [
        'a1,a2,"a3', 
        '#b1","b2"",b3",b4,"b5', 
        'c1,c2"'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 4, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/100);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 6)], [fvr(0, 6, 9), fvr(1, 0, 5)], [fvr(1, 5, 15)], [fvr(1, 15, 18)], [fvr(1, 18, 21), fvr(2, 0, 6)]];
    assert.deepEqual([record_ranges_0], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Discard some parsed lines which belongs to a record starting outside the parsing range
    doc_lines = [
        'a1,"a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2"', 
        'e1,e2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 20, 0); // doesn't include first line with the openning double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Now shift window one back - it should include all lines now.
    doc_lines = [
        'a1,"a2', 
        'b1,b2', 
        'c1,c2', 
        'd1,d2"', 
        'e1,e2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 20, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 6), fvr(1, 0, 5), fvr(2, 0, 5), fvr(3, 0, 6)]];
    record_ranges_1 = [[fvr(4, 0, 3)], [fvr(4, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Include only the first 2 records because end of the record is outside the parsing window.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,"c2', 
        'd1,d2', 
        'e1,e2', 
        'f1,f2"'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 5, 0); // doesn't include the last line with the closing double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Now include everything because the end record got inside the parsing window
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,"c2', 
        'd1,d2', 
        'e1,e2', 
        'f1,f2"'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 6, 0); // doesn't include the last line with the closing double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 5)]];
    record_ranges_1 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    record_ranges_2 = [[fvr(2, 0, 3)], [fvr(2, 3, 6), fvr(3, 0, 5), fvr(4, 0, 5), fvr(5, 0, 6)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // ===================================================================================
    // Beginning of 4 related test on the same data but with the different parsing windows

    // Nothing is parsed because the window started at the record which end didn't fit into the parsing range.
    doc_lines = [
        'a1,"a2', 
        'b1,b2', 
        'c1","c2', 
        'd1,d2', 
        '#hello world', 
        'e1,e2', 
        'f1",f2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 6, 0); // doesn't include the last line with the closing double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    assert.deepEqual([], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);

    // Same as before but the window is shifted slightly so we (wrongly) assume that the internal field lines are independent records.
    doc_lines = [
        'a1,"a2', 
        'b1,b2', 
        'c1","c2', 
        'd1,d2', 
        '#hello world', 
        'e1,e2', 
        'f1",f2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 6, 0); // doesn't include the last line with the closing double quote.
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(1, 0, 3)], [fvr(1, 3, 5)]];
    // Note that the third line `c1","c2` is not parsed because since parser assumes it to be an independent record it contains syntax errors.
    record_ranges_1 = [[fvr(3, 0, 3)], [fvr(3, 3, 5)]];
    record_ranges_2 = [[fvr(5, 0, 3)], [fvr(5, 3, 5)]];
    assert.deepEqual([record_ranges_0, record_ranges_1, record_ranges_2], table_record_ranges);
    // Although `#hello world` is actually part of the multiline field we wrongly assume it to be a comment since our parsing window don't cover neither begin nor end of the record.
    assert.deepEqual([fvr(4, 0, 12)], table_comment_ranges);

    // Nothing is parsed again because the window ends right at the closing line and the beginning didn't fit.
    doc_lines = [
        'a1,"a2', 
        'b1,b2', 
        'c1","c2', 
        'd1,d2', 
        '#hello world', 
        'e1,e2', 
        'f1",f2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(1, 0, 7, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    assert.deepEqual([], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);


    // All lines now fit in the range and they are being properly parsed as a single record.
    doc_lines = [
        'a1,"a2', 
        'b1,b2', 
        'c1","c2', 
        'd1,d2', 
        '#hello world', 
        'e1,e2', 
        'f1",f2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    range = new vscode_test_double.Range(0, 0, 7, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
    [table_comment_ranges, table_record_ranges] = convert_ranges_to_triples(table_ranges);
    record_ranges_0 = [[fvr(0, 0, 3)], [fvr(0, 3, 6), fvr(1, 0, 5), fvr(2, 0, 4)], [fvr(2, 4, 7), fvr(3, 0, 5), fvr(4, 0, 12), fvr(5, 0, 5), fvr(6, 0, 4)], [fvr(6, 4, 6)]];
    assert.deepEqual([record_ranges_0], table_record_ranges);
    assert.deepEqual([], table_comment_ranges);


    // End of 4 related test on the same data but with the different parsing windows
    // ===================================================================================


    // Discard some at the beginning and some at the end where the record didn't fit into the parsing window
    doc_lines = [
        'a1;"a2', 
        'b1;b2', 
        'c1";c2', 
        'd1;d2', 
        '#hello world', 
        'e1;e2', 
        'f1;"f2', 
        'g1;g2', 
        'h1";h2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ';';
    range = new vscode_test_double.Range(1, 0, 8, 0);
    table_ranges = rainbow_utils.parse_document_range_rfc(vscode_test_double, active_doc, delim, /*include_delim_length_in_ranges=*/true, comment_prefix, range, /*custom_parsing_margin=*/0);
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
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1,c2', 
        'd1,d2'
    ];
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
    doc_lines = [
        'a1,"a2', 
        'b1",b2', 
        '#comment', 
        'c1,"c2', 
        'd1,d2'
    ];
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
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1,c2', 
        'd1,d2', 
        'e1,e2'
    ];
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
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1,c2', 
        'd1,d2', 
        'e1,e2'
    ];
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
    doc_lines = [
        '1'.repeat(251) + ',' + '2'.repeat(251)
    ];
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
    doc_lines = [
        '#info', 
        '#info', 
        '#info', 
        '#info', 
        '#info', 
        '#info', 
        '#info', 
        '#info', 
        '#info', 
        '#info', 
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1,c2', 
        'd1,d2'
    ];
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
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        'c1,c2', 
        '#comment', 
        'd1,d2', 
        'e1,e2', 
        'f1,f2', 
        'g1,g2', 
        'h1,h2', 
        'i1,i2', 
        'j1,j2', 
        'k1,k2', 
        'l1,l2', 
        'm1,m2', 
        'n1,n2', 
        'o1"",o2'
    ];
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
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'simple';
    comment_prefix = '#';
    position = new VscodePositionTestDouble(/*line=*/3, /*character=*/3);
    position_info = rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, position);
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, position_info);

    // Delim character maps to preceeding field.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'simple';
    comment_prefix = '#';
    position = new VscodePositionTestDouble(/*line=*/3, /*character=*/2);
    position_info = rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, position);
    assert.deepEqual({column_number: 0, total_columns: 2, split_warning: false}, position_info);

    // Basic test, comment
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'simple';
    comment_prefix = '#';
    position = new VscodePositionTestDouble(/*line=*/2, /*character=*/5);
    position_info = rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, position);
    assert.deepEqual({is_comment: true}, position_info);

    // Column info for the last character in line.
    doc_lines = [
        'a1,a2', 
        'b1,b2', 
        '#comment', 
        'c1,c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'simple';
    comment_prefix = '#';
    position = new VscodePositionTestDouble(/*line=*/3, /*character=*/4);
    position_info = rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, position);
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, position_info);

    // Multicharacter separator test - critical locations across field boundaries.
    doc_lines = [
        'a1@@@a2@@@a3', 
        'b1@@@b2@@@b3', 
        '#comment', 
        'c1@@@c2@@@c3', 
        'd1@@@d2@@@d3'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = '@@@';
    policy = 'simple';
    comment_prefix = '#';
    assert.deepEqual({column_number: 0, total_columns: 3, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/4)));
    assert.deepEqual({column_number: 1, total_columns: 3, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/5)));
    assert.deepEqual({column_number: 1, total_columns: 3, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/9)));
    assert.deepEqual({column_number: 2, total_columns: 3, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/10)));

    // Column info for whitespace policy.
    doc_lines = [
        'a1  a2 ', 
        'b1    b2', 
        '$$comment', 
        '$c1  c2  ', 
        'd1   d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ' ';
    policy = 'whitespace';
    comment_prefix = '$$';
    assert.deepEqual({column_number: 0, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/0)));
    assert.deepEqual({column_number: 0, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/4)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/5)));
    assert.deepEqual({is_comment: true}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/2, /*character=*/6)));

    // Test with quoted policy and split warning.
    doc_lines = [
        'a1,a2', 
        '$b1,"b2', 
        '$$comment', 
        '"c1,""c1""",c2', 
        'd1,d2'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    delim = ',';
    policy = 'quoted';
    comment_prefix = '$$';
    assert.deepEqual({column_number: 0, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/11)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: false}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/3, /*character=*/12)));
    assert.deepEqual({column_number: 1, total_columns: 2, split_warning: true}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/1, /*character=*/4)));
    assert.deepEqual({is_comment: true}, rainbow_utils.get_cursor_position_info(vscode_test_double, active_doc, delim, policy, comment_prefix, new VscodePositionTestDouble(/*line=*/2, /*character=*/6)));

    // Quoted RFC policy test.
    doc_lines = [
        'a1,a2', 
        '#comment', 
        'b1,"b2', 
        '#not a ""comment"", inside multiline field!', 
        'd1,d2"', 
        'e1,"e2,e2"', 
        'f1,"f2'
    ];
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


function test_align_columns() {
    let [unaligned_doc_lines, active_doc, delim, policy, comment_prefix] = [null, null, null, null, null];
    let [column_stats, first_failed_line, records, comments] = [null, null, null, null];
    let [aligned_doc_text, aligned_doc_lines, expected_doc_lines] = [null, null]

    // Basic test with numeric column.
    unaligned_doc_lines = [
        'type,weight',
        'car,100',
        'ship,20000'
    ];
    active_doc = new VscodeDocumentTestDouble(unaligned_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    aligned_doc_text = rainbow_utils.align_columns(records, comments, column_stats, delim);
    aligned_doc_lines = aligned_doc_text.split('\n');
    expected_doc_lines = [
        'type, weight',
        'car ,    100',
        'ship,  20000'
    ];
    assert.deepEqual(expected_doc_lines, aligned_doc_lines);

    // Basic test with string-only columns.
    unaligned_doc_lines = [
        'type,color',
        'car,red',
        'ship,orange'
    ];
    active_doc = new VscodeDocumentTestDouble(unaligned_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    aligned_doc_text = rainbow_utils.align_columns(records, comments, column_stats, delim);
    aligned_doc_lines = aligned_doc_text.split('\n');
    expected_doc_lines = [
        'type, color',
        'car , red',
        'ship, orange'
    ];
    assert.deepEqual(expected_doc_lines, aligned_doc_lines);

    // Basic test with float column and random spaces.
    unaligned_doc_lines = [
        '  type, wght,  color ',
        '  car  ,   1.008  ,   red',
        '   ship ,  200.5  ,  yellow'
    ];
    active_doc = new VscodeDocumentTestDouble(unaligned_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    aligned_doc_text = rainbow_utils.align_columns(records, comments, column_stats, delim);
    aligned_doc_lines = aligned_doc_text.split('\n');
    expected_doc_lines = [
        'type, wght   , color',
        'car ,   1.008, red',
        'ship, 200.5  , yellow'
    ];
    assert.deepEqual(expected_doc_lines, aligned_doc_lines);

    // Basic test with comment lines and last empty line which should not diappear after alignment.
    unaligned_doc_lines = [
        '#info',
        'type,weight',
        '#foo,foo',
        '#m',
        'car,100',
        'ship,20000',
        '#bar', '#bar', ''
    ];
    active_doc = new VscodeDocumentTestDouble(unaligned_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    aligned_doc_text = rainbow_utils.align_columns(records, comments, column_stats, delim);
    aligned_doc_lines = aligned_doc_text.split('\n');
    expected_doc_lines = [
        '#info',
        'type, weight',
        '#foo,foo',
        '#m',
        'car ,    100',
        'ship,  20000',
        '#bar',
        '#bar',
        ''
    ];
    assert.deepEqual(expected_doc_lines, aligned_doc_lines);

    // RFC multiline fields test.
    unaligned_doc_lines = [
        'type,info,max_speed',
        'car,"A nice red car.',
        'Can get you ""anywhere"" you want.',
        'GPS included",100',
        'ship,"Big heavy superfreighter ""Yamaha-2000"".',
        'Comes with a crew of 10",25'
    ];
    active_doc = new VscodeDocumentTestDouble(unaligned_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    aligned_doc_text = rainbow_utils.align_columns(records, comments, column_stats, delim);
    aligned_doc_lines = aligned_doc_text.split('\n');
    expected_doc_lines = [
        'type, info                                      , max_speed',
        'car , "A nice red car.',
        '      Can get you ""anywhere"" you want.',
        '      GPS included"                             ,       100',
        'ship, "Big heavy superfreighter ""Yamaha-2000"".',
        '      Comes with a crew of 10"                  ,        25'
    ];
    assert.deepEqual(expected_doc_lines, aligned_doc_lines);

    // Test with syntax error.
    unaligned_doc_lines = [
        'type,color',
        'car,red',
        'ship",orange'
    ];
    active_doc = new VscodeDocumentTestDouble(unaligned_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [column_stats, first_failed_line, records, comments] = rainbow_utils.calc_column_stats(active_doc, delim, policy, comment_prefix, /*enable_double_width_alignment=*/true);
    assert.equal(null, column_stats);
    assert.equal(3, first_failed_line);
    assert.equal(null, records);
}

function test_shrink_columns() {
    let [original_doc_lines, active_doc, delim, policy, comment_prefix] = [null, null, null, null, null];
    let [first_failed_line, shrinked_doc_text, shrinked_doc_lines, expected_doc_lines] = [null, null, null, null];

    // Basic test.
    original_doc_lines = [
        '  type  , weight, color',
        ' car,100  , yellow   ',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(original_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [shrinked_doc_text, first_failed_line] = rainbow_utils.shrink_columns(active_doc, delim, policy, comment_prefix);
    shrinked_doc_lines = shrinked_doc_text.split('\n');
    expected_doc_lines = [
        'type,weight,color',
        'car,100,yellow',
        'ship,20000,red'
    ];
    assert.deepEqual(expected_doc_lines, shrinked_doc_lines);

    // No edits (already shrinked) should be reported as null.
    original_doc_lines = [
        'type,weight,color',
        'car,100,yellow',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(original_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [shrinked_doc_text, first_failed_line] = rainbow_utils.shrink_columns(active_doc, delim, policy, comment_prefix);
    assert.equal(null, first_failed_line);
    assert.equal(null, shrinked_doc_text);

    // Test with comments and last trailing line.
    original_doc_lines = [
        '#hello',
        '  type  , weight, color',
        '#foo',
        '#bar',
        ' car,100  , yellow   ',
        'ship,20000,red',
        '# foo , bar',
        ''
    ];
    active_doc = new VscodeDocumentTestDouble(original_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [shrinked_doc_text, first_failed_line] = rainbow_utils.shrink_columns(active_doc, delim, policy, comment_prefix);
    shrinked_doc_lines = shrinked_doc_text.split('\n');
    expected_doc_lines = [
        '#hello',
        'type,weight,color',
        '#foo',
        '#bar',
        'car,100,yellow',
        'ship,20000,red',
        '# foo , bar',
        ''
    ];
    assert.deepEqual(expected_doc_lines, shrinked_doc_lines);

    // Test with syntax error.
    original_doc_lines = [
        '  type  , weight, color',
        ' car,100  , yellow   ',
        'ship,20000",red'
    ];
    active_doc = new VscodeDocumentTestDouble(original_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    [shrinked_doc_text, first_failed_line] = rainbow_utils.shrink_columns(active_doc, delim, policy, comment_prefix);
    assert.equal(first_failed_line, 3);
    assert.equal(shrinked_doc_text, null);

    // RFC multiline fields test.
    original_doc_lines = [
        'type ,info                                       ,max_speed',
        'car  ,"A nice red car.',
        '      Can get you ""anywhere"" you want.',
        '      GPS included"                              ,      100',
        'ship ,"Big heavy superfreighter ""Yamaha-2000"".',
        '      Comes with a crew of 10"                   ,       25'
    ];
    active_doc = new VscodeDocumentTestDouble(original_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [shrinked_doc_text, first_failed_line] = rainbow_utils.shrink_columns(active_doc, delim, policy, comment_prefix);
    shrinked_doc_lines = shrinked_doc_text.split('\n');
    expected_doc_lines = [
        'type,info,max_speed',
        'car,"A nice red car.',
        'Can get you ""anywhere"" you want.',
        'GPS included",100',
        'ship,"Big heavy superfreighter ""Yamaha-2000"".',
        'Comes with a crew of 10",25'
    ];
    assert.deepEqual(expected_doc_lines, shrinked_doc_lines);

    // RFC multiline fields test with no edits.
    original_doc_lines = [
        'type,info,max_speed',
        'car,"A nice red car.',
        'Can get you ""anywhere"" you want.',
        'GPS included",100',
        'ship,"Big heavy superfreighter ""Yamaha-2000"".',
        'Comes with a crew of 10",25'
    ];
    active_doc = new VscodeDocumentTestDouble(original_doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    [shrinked_doc_text, first_failed_line] = rainbow_utils.shrink_columns(active_doc, delim, policy, comment_prefix);
    assert.equal(null, first_failed_line);
    assert.equal(null, shrinked_doc_text);
}


function get_all_entries(record_comment_merger) {
    let result = [];
    while (record_comment_merger.has_entries_left()) {
        result.push(record_comment_merger.get_next());
    }
    return result;
}


function test_record_comment_merger() {
    let [records, comments] = [null, null];
    let record_comment_merger = null;
    let [entries, expected_entries] = [null, null];

    // Basic test.
    records = [
        'hello', 
        'world'
    ];
    comments = [
        {record_num: 0, comment_text: '#foo'},
        {record_num: 2, comment_text: '#bar1'},
        {record_num: 2, comment_text: '#bar2'}
    ];
    record_comment_merger = new rainbow_utils.RecordCommentMerger(records, comments);
    entries = get_all_entries(record_comment_merger);
    expected_entries = [
        [null, '#foo'], 
        ['hello', null], 
        ['world', null],
        [null, '#bar1'], 
        [null, '#bar2'], 
    ];
    assert.deepEqual(expected_entries, entries);

    // No records.
    records = [
    ];
    comments = [
        {record_num: 0, comment_text: '#foo'},
        {record_num: 2, comment_text: '#bar1'},
        {record_num: 2, comment_text: '#bar2'}
    ];
    record_comment_merger = new rainbow_utils.RecordCommentMerger(records, comments);
    entries = get_all_entries(record_comment_merger);
    expected_entries = [
        [null, '#foo'], 
        [null, '#bar1'], 
        [null, '#bar2'], 
    ];
    assert.deepEqual(expected_entries, entries);

    // No comments.
    records = [
        'hello', 
        'world'
    ];
    comments = [
    ];
    record_comment_merger = new rainbow_utils.RecordCommentMerger(records, comments);
    entries = get_all_entries(record_comment_merger);
    expected_entries = [
        ['hello', null], 
        ['world', null],
    ];
    assert.deepEqual(expected_entries, entries);

    // No records and no comments.
    records = [
    ];
    comments = [
    ];
    record_comment_merger = new rainbow_utils.RecordCommentMerger(records, comments);
    entries = get_all_entries(record_comment_merger);
    expected_entries = [
    ];
    assert.deepEqual(expected_entries, entries);
}


function test_generate_column_edit_selections() {
    let [doc_lines, active_doc, delim, policy, comment_prefix, edit_mode, col_num] = [null, null, null, null, null, null, null];
    let [selections, error_msg, warning_msg] = [null, null, null];
    let [expected_selections, expected_error_msg, expected_warning_msg] = [null, null, null];

    // Basic test.
    doc_lines = [
        'type,weight,color',
        'car,100,yellow',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    edit_mode = 'ce_before';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal(null, error_msg);
    assert.equal(null, warning_msg);
    expected_selections = [
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(0, 5), new VscodePositionTestDouble(0, 5)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(1, 4), new VscodePositionTestDouble(1, 4)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(2, 5), new VscodePositionTestDouble(2, 5)),
    ];
    assert.deepEqual(expected_selections, selections);

    // Basic test with quoted_rfc.
    doc_lines = [
        'type,weight,color',
        'car,100,yellow',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    edit_mode = 'ce_before';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal(null, error_msg);
    assert.equal(null, warning_msg);
    expected_selections = [
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(0, 5), new VscodePositionTestDouble(0, 5)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(1, 4), new VscodePositionTestDouble(1, 4)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(2, 5), new VscodePositionTestDouble(2, 5)),
    ];
    assert.deepEqual(expected_selections, selections);

    // Test with multiline fields.
    doc_lines = [
        'type,weight,color',
        'car,100,"yellow',
        ' and black"',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted_rfc';
    edit_mode = 'ce_before';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal('Column edit mode is not supported for files with multiline fields', error_msg);

    // Basic test with comments.
    doc_lines = [
        'type,weight,color',
        'car,100,yellow',
        '#hello world',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    edit_mode = 'ce_before';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal(null, error_msg);
    assert.equal(null, warning_msg);
    expected_selections = [
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(0, 5), new VscodePositionTestDouble(0, 5)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(1, 4), new VscodePositionTestDouble(1, 4)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(3, 5), new VscodePositionTestDouble(3, 5)),
    ];
    assert.deepEqual(expected_selections, selections);

    // Test with quoting error.
    doc_lines = [
        'type,weight,color',
        'car,100,yellow " red',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    edit_mode = 'ce_before';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal('Unable to enter column edit mode: quoting error at line 2', error_msg);
    assert.equal(null, warning_msg);
    assert.deepEqual(null, selections);

    // Test with inconsistent fields length.
    doc_lines = [
        'type,weight,color',
        'car,100,yellow',
        'rocket,1000',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    edit_mode = 'ce_before';
    col_num = 2; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal('Line 3 doesn\'t have field number 3', error_msg);
    assert.equal(null, warning_msg);
    assert.deepEqual(null, selections);

    // Test with "ce_before" and a double quote in proximity.
    doc_lines = [
        'type,weight,color',
        'car,"100",yellow',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    edit_mode = 'ce_before';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal(null, error_msg);
    assert.equal("Be careful, cursor at line 2 has a double quote is in proximity.", warning_msg);
    expected_selections = [
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(0, 5), new VscodePositionTestDouble(0, 5)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(1, 4), new VscodePositionTestDouble(1, 4)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(2, 5), new VscodePositionTestDouble(2, 5)),
    ];
    assert.deepEqual(expected_selections, selections);

    // Test with "ce_after" and a double quote in proximity.
    doc_lines = [
        'type,weight,color',
        'car,"100",yellow',
        'ship,20000,red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = ',';
    policy = 'quoted';
    edit_mode = 'ce_after';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal(null, error_msg);
    assert.equal("Be careful, cursor at line 2 has a double quote is in proximity.", warning_msg);
    expected_selections = [
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(0, 11), new VscodePositionTestDouble(0, 11)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(1, 9), new VscodePositionTestDouble(1, 9)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(2, 10), new VscodePositionTestDouble(2, 10)),
    ];
    assert.deepEqual(expected_selections, selections);

    // Test with "ce_select" and an empty field.
    doc_lines = [
        'type\tweight\tcolor',
        'car\t\tyellow',
        'ship\t20000\tred'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = '\t';
    policy = 'simple';
    edit_mode = 'ce_select';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal(null, error_msg);
    assert.equal("Be careful, Field 2 at line 2 is empty.", warning_msg);
    expected_selections = [
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(0, 5), new VscodePositionTestDouble(0, 11)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(1, 4), new VscodePositionTestDouble(1, 4)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(2, 5), new VscodePositionTestDouble(2, 10)),
    ];
    assert.deepEqual(expected_selections, selections);

    // Test with "ce_after", double quote in proximity and simple policy.
    doc_lines = [
        'type|weight|color',
        'car|"100"|yellow',
        'ship|20000|red'
    ];
    active_doc = new VscodeDocumentTestDouble(doc_lines);
    comment_prefix = '#';
    delim = '|';
    policy = 'simple';
    edit_mode = 'ce_after';
    col_num = 1; // 0-based.
    [selections, error_msg, warning_msg] = rainbow_utils.generate_column_edit_selections(vscode_test_double, active_doc, delim, policy, comment_prefix, edit_mode, col_num);
    assert.equal(null, error_msg);
    assert.equal(null, warning_msg);
    expected_selections = [
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(0, 11), new VscodePositionTestDouble(0, 11)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(1, 9), new VscodePositionTestDouble(1, 9)),
        new VscodeSelectionTestDouble(new VscodePositionTestDouble(2, 10), new VscodePositionTestDouble(2, 10)),
    ];
    assert.deepEqual(expected_selections, selections);
}


function test_all() {
    test_offsets_calculation();
    test_adjusted_length();
    test_reconcile_single();
    test_reconcile_multiple();
    test_generate_inlay_hints();
    test_calc_column_stats_for_fragment();
    test_align_stats();
    test_field_align();
    test_rfc_field_align();
    test_align_columns();
    test_shrink_columns();
    test_calc_column_stats();
    test_parse_document_records();
    test_parse_document_range_rfc();
    test_parse_document_range_single_line();
    test_is_opening_rfc_line();
    test_sample_preview_records_from_context();
    test_show_lint_status_bar_button();
    test_get_cursor_position_info();
    test_record_comment_merger();
    test_generate_column_edit_selections();
}

exports.test_all = test_all;
exports.VscodePositionTestDouble = VscodePositionTestDouble;
exports.VscodeRangeTestDouble = VscodeRangeTestDouble;
exports.VscodeDocumentTestDouble = VscodeDocumentTestDouble;
exports.vscode_test_double = vscode_test_double;
