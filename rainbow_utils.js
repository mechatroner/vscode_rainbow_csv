const os = require('os');
const fs = require('fs');
const path = require('path');

const rbql = require('./rbql_core/rbql-js/rbql.js');
const rbql_csv = require('./rbql_core/rbql-js/rbql_csv.js');
const csv_utils = require('./rbql_core/rbql-js/csv_utils.js');

const fast_load_utils = require('./fast_load_utils.js');

const wcwidth = require('./contrib/wcwidth/index.js');

const non_numeric_sentinel = -1;
const number_regex = /^([0-9]+)(\.[0-9]+)?$/;

// Copypasted from extension.js
const QUOTED_RFC_POLICY = 'quoted_rfc';
const QUOTED_POLICY = 'quoted';
const dynamic_csv_highlight_margin = 50; // TODO make configurable.
const max_preview_field_length = 250;
const alignment_extra_readability_whitespace_length = 1;


class AssertionError extends Error {}

function assert(condition, message=null) {
    if (!condition) {
        if (!message) {
            message = 'Assertion error';
        }
        throw new AssertionError(message);
    }
}


function get_default_js_udf_content() {
    let default_content = `// This file can be used to store RBQL UDFs. Example:
    //
    // function foo(value) {
    //     return 'foo ' + String(value.length);
    // }
    // 
    // Functions defined in this file can be used in RBQL queries e.g.
    // SELECT foo(a1), a2 WHERE foo(a3) != 'foo 5' LIMIT 10
    //
    // Don't forget to save this file after editing!
    //
    // Write your own functions below this line:
    `.replace(new RegExp(/^  */, 'mg'), '');
    return default_content;
}


function get_default_python_udf_content() {
    let default_content = `# This file can be used to store RBQL UDFs. Example:
    #
    # def foo(value):
    #     return 'foo ' + str(len(value))
    # 
    # 
    # Functions defined in this file can be used in RBQL queries e.g.
    # SELECT foo(a1), a2 WHERE foo(a3) != 'foo 5' LIMIT 10
    #
    # Don't forget to save this file after editing!
    #
    # Write your own functions below this line:
    `.replace(new RegExp(/^  */, 'mg'), '');
    return default_content;
}


function update_subcomponent_stats(field, is_first_record, max_field_components_lens, calc_visual_char_width) {
    // Extract overall field length and length of integer and fractional parts of the field if it represents a number.
    let visual_field_length = calc_visual_char_width ? wcwidth(field) : field.length;
    max_field_components_lens.has_wide_chars = max_field_components_lens.has_wide_chars || visual_field_length != field.length;
    max_field_components_lens.max_total_length = Math.max(max_field_components_lens.max_total_length, visual_field_length);
    if (max_field_components_lens.max_int_length == non_numeric_sentinel) {
        // Column is not a number, early return.
        return;
    }
    let match_result = number_regex.exec(field);
    if (match_result === null) {
        if (!is_first_record && field.length) { // Checking field_length here allows numeric columns to have some of the fields empty.
            // We only mark the column as non-header if we know that this is not a header line.
            max_field_components_lens.max_int_length = non_numeric_sentinel;
            max_field_components_lens.max_fractional_length = non_numeric_sentinel;
        }
        return;
    }
    let cur_integer_part_length = match_result[1].length;
    max_field_components_lens.max_int_length = Math.max(max_field_components_lens.max_int_length, cur_integer_part_length);
    let cur_fractional_part_length = match_result[2] === undefined ? 0 : match_result[2].length;
    max_field_components_lens.max_fractional_length = Math.max(max_field_components_lens.max_fractional_length, cur_fractional_part_length);
}


function get_cursor_position_if_unambiguous(active_editor) {
    let selections = active_editor.selections;
    if (!selections || selections.length != 1) {
        // Support only single-cursor, multicursor is ambiguous.
        return null;
    }
    let selection = selections[0];
    let position = selection.active;
    if (!position.isEqual(selection.anchor)) {
        // Selections are ambiguous.
        return null;
    }
    return position;
}


function is_ascii(src_str) {
    return /^[\x00-\x7F]*$/.test(src_str);
}


function calc_column_stats(active_doc, delim, policy, comment_prefix, enable_double_width_alignment) {
    let [records, _num_records_parsed, _fields_info, first_defective_line, _first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/true);
    if (first_defective_line !== null) {
        return [null, first_defective_line + 1, null, null];
    }
    let column_stats = [];
    let is_first_record = true;
    let calc_visual_char_width = false;
    for (let record of records) {
        for (let fnum = 0; fnum < record.length; fnum++) {
            if (column_stats.length <= fnum) {
                column_stats.push({max_total_length: 0, max_int_length: 0, max_fractional_length: 0, has_wide_chars: false});
            }
            let field = record[fnum];
            if (!calc_visual_char_width && enable_double_width_alignment) {
                calc_visual_char_width = !is_ascii(field);
            }
            let field_lines = field.split('\n');
            if (field_lines.length > 1) {
                // We don't allow multiline fields to be numeric for simplicity.
                column_stats[fnum].max_int_length = non_numeric_sentinel;
                column_stats[fnum].max_fractional_length = non_numeric_sentinel;
            }
            for (let field_line of field_lines) {
                update_subcomponent_stats(field_line.trim(), is_first_record, column_stats[fnum], calc_visual_char_width);
            }
        }
        is_first_record = false;
    }
    return [column_stats, null, records, comments];
}


function adjust_column_stats(column_stats, delim_length) {
    // Ensure that numeric components max widths are consistent with non-numeric (header) width.
    let adjusted_stats = [];
    for (let column_stat of column_stats) {
        if (column_stat.max_int_length <= 0) {
            column_stat.max_int_length = -1;
            column_stat.max_fractional_length = -1;
        }
        if (column_stat.max_int_length > 0) {
            // The sum of integer and float parts can be bigger than the max width, e.g. here:
            // value
            // 0.12
            // 1234
            if (column_stat.max_int_length + column_stat.max_fractional_length > column_stat.max_total_length) {
                column_stat.max_total_length = column_stat.max_int_length + column_stat.max_fractional_length;
            }
            // This is needed when the header is wider than numeric components and/or their sum.
            if (column_stat.max_total_length - column_stat.max_fractional_length > column_stat.max_int_length) {
                column_stat.max_int_length = column_stat.max_total_length - column_stat.max_fractional_length;
            }
            // Sanity check.
            if (column_stat.max_total_length != column_stat.max_int_length + column_stat.max_fractional_length) {
                // Assertion Error, this can never happen.
                return null;
            }
        }
        let previous_stat = adjusted_stats.length ? adjusted_stats[adjusted_stats.length - 1] : null;
        column_stat.start_offset = previous_stat === null ? 0 : previous_stat.start_offset + previous_stat.max_total_length + alignment_extra_readability_whitespace_length + delim_length;
        adjusted_stats.push(column_stat);
    }
    return adjusted_stats;
}


function align_field(field, is_first_record, max_field_components_lens, is_last_in_line) {
    // Align field, use Math.max() to avoid negative delta_length which can happen theorethically due to async doc edit.
    field = field.trim();
    let visual_field_length = max_field_components_lens.has_wide_chars ? wcwidth(field) : field.length;
    if (max_field_components_lens.max_int_length == non_numeric_sentinel) {
        let delta_length = Math.max(max_field_components_lens.max_total_length - visual_field_length, 0);
        return is_last_in_line ? field : field + ' '.repeat(delta_length + alignment_extra_readability_whitespace_length);
    }
    if (is_first_record) {
        if (number_regex.exec(field) === null) {
            // The line must be a header - align it using max_width rule.
            let delta_length = Math.max(max_field_components_lens.max_total_length - visual_field_length, 0);
            return is_last_in_line ? field : field + ' '.repeat(delta_length + alignment_extra_readability_whitespace_length);
        }
    }
    let dot_pos = field.indexOf('.');
    let cur_integer_part_length = dot_pos == -1 ? field.length : dot_pos;
    // Here cur_fractional_part_length includes the leading dot too.
    let cur_fractional_part_length = dot_pos == -1 ? 0 : field.length - dot_pos;
    let integer_delta_length = Math.max(max_field_components_lens.max_int_length - cur_integer_part_length, 0);
    let fractional_delta_length = Math.max(max_field_components_lens.max_fractional_length - cur_fractional_part_length);
    let trailing_spaces = is_last_in_line ? '' : ' '.repeat(fractional_delta_length + alignment_extra_readability_whitespace_length);
    return ' '.repeat(integer_delta_length) + field + trailing_spaces;
}


function rfc_align_field(field, is_first_record, max_field_components_lens, is_field_segment, is_last_in_line) {
    let aligned = align_field(field, is_first_record, max_field_components_lens, is_last_in_line);
    if (is_field_segment) {
        aligned = ' '.repeat(max_field_components_lens.start_offset) + aligned;
    }
    return aligned;
}


class RecordCommentMerger {
    constructor(records, comments) {
        this.records = records;
        this.comments = comments;
        this.nr = 0;
        this.next_comment = 0;
    }

    get_next() {
        // Returns tuple (record, comment).
        if (this.has_comments_left() && (!this.has_records_left() || this.comments[this.next_comment].record_num <= this.nr)) {
            let result = [null, this.comments[this.next_comment].comment_text];
            this.next_comment += 1;
            return result;
        }
        if (this.has_records_left()) {
            let result = [this.records[this.nr], null];
            this.nr += 1;
            return result;
        }
        return [null, null];
    }

    has_comments_left() {
        return this.next_comment < this.comments.length;
    }

    has_records_left() {
        return this.nr < this.records.length;
    }

    has_entries_left() {
        return this.has_comments_left() || this.has_records_left();
    }
}


function align_columns(records, comments, column_stats, delim) {
    // Unlike shrink_columns, here we don't compute `has_edit` flag because it is
    // 1: Algorithmically complicated (especially for multiline fields) and we also can't just compare fields lengths like in shrink.
    // 2: The alignment procedure is opinionated and "Already aligned" report has little value.
    // Because of this in case of executing "Align" command consecutively N times one would have to run undo N times too.
    let result_lines = [];
    let is_first_record = true;
    let merger = new RecordCommentMerger(records, comments);
    while (merger.has_entries_left()) {
        let [record, comment] = merger.get_next();
        assert((comment === null) != (record === null));
        if (record === null) {
            result_lines.push(comment);
            continue;
        }
        let aligned_fields = [];
        for (let fnum = 0; fnum < record.length; fnum++) {
            if (fnum >= column_stats.length) // Safeguard against async doc edit, should never happen.
                break;
            let is_field_segment = false;
            let field = record[fnum];
            let field_lines = field.split('\n');
            for (let i = 0; i < field_lines.length; i++) {
                if (i > 0) {
                    result_lines.push(aligned_fields.join(delim));
                    aligned_fields = [];
                    is_field_segment = true;
                }
                let is_last_in_line = fnum + 1 == record.length || (field_lines.length > 1 && i + 1 < field_lines.length);
                let aligned_field = rfc_align_field(field_lines[i], is_first_record, column_stats[fnum], is_field_segment, is_last_in_line);
                is_field_segment = false;
                aligned_fields.push(aligned_field);
            }
        }
        is_first_record = false;
        result_lines.push(aligned_fields.join(delim));
    }
    return result_lines.join('\n');
}


function shrink_columns(active_doc, delim, policy, comment_prefix) {
    let [records, _num_records_parsed, _fields_info, first_defective_line, _first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/true);
    if (first_defective_line !== null) {
        return [null, first_defective_line + 1];
    }
    let result_lines = [];
    let has_edit = false;
    let merger = new RecordCommentMerger(records, comments);
    while (merger.has_entries_left()) {
        let [record, comment] = merger.get_next();
        assert((comment === null) != (record === null));
        if (record === null) {
            result_lines.push(comment);
            continue;
        }
        let aligned_fields = [];
        for (let fnum = 0; fnum < record.length; fnum++) {
            let field = record[fnum];
            let field_lines = field.split('\n');
            for (let i = 0; i < field_lines.length; i++) {
                if (i > 0) {
                    result_lines.push(aligned_fields.join(delim));
                    aligned_fields = [];
                }
                let aligned_field = field_lines[i].trim();
                if (aligned_field.length != field_lines[i].length) {
                    // Unlike in align function here we can just compare resulting length to decide if change has occured.
                    has_edit = true;
                }
                aligned_fields.push(aligned_field);
            }
        }
        result_lines.push(aligned_fields.join(delim));
    }
    if (!has_edit)
        return [null, null];
    return [result_lines.join('\n'), null];
}


function make_table_name_key(file_path) {
    return 'rbql_table_name:' + file_path;
}


function expanduser(filepath) {
    if (filepath.charAt(0) === '~') {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
}


function find_table_path(vscode_global_state, main_table_dir, table_id) {
    // If table_id is a relative path it could be relative either to the current directory or to the main table dir.
    var candidate_path = expanduser(table_id);
    if (fs.existsSync(candidate_path)) {
        return candidate_path;
    }
    if (main_table_dir && !path.isAbsolute(candidate_path)) {
        candidate_path = path.join(main_table_dir, candidate_path);
        if (fs.existsSync(candidate_path)) {
            return candidate_path;
        }
    }
    let table_path = vscode_global_state ? vscode_global_state.get(make_table_name_key(table_id)) : null;
    if (table_path && fs.existsSync(table_path)) {
        return table_path;
    }
    return null;
}


async function read_header(table_path, encoding) {
    if (encoding == 'latin-1')
        encoding = 'binary';
    let readline = require('readline');
    let input_reader = readline.createInterface({ input: fs.createReadStream(table_path, {encoding: encoding}) });
    let closed = false;
    let promise_resolve = null;
    let promise_reject = null;
    let output_promise = new Promise(function(resolve, reject) {
        promise_resolve = resolve;
        promise_reject = reject;
    });
    input_reader.on('line', line => {
        if (!closed) {
            closed = true;
            input_reader.close();
            promise_resolve(line);
        }
    });
    input_reader.on('error', error => {
        promise_reject(error);
    });
    return output_promise;
}


function get_header_line(document, comment_prefix) {
    const num_lines = document.lineCount;
    for (let lnum = 0; lnum < num_lines; ++lnum) {
        const line_text = document.lineAt(lnum).text;
        if (!comment_prefix || !line_text.startsWith(comment_prefix)) {
            return [lnum, line_text];
        }
    }
    return [null, null];
}


function make_inconsistent_num_fields_warning(table_name, inconsistent_records_info) {
    let [record_num_1, num_fields_1, record_num_2, num_fields_2] = rbql.sample_first_two_inconsistent_records(inconsistent_records_info);
    let warn_msg = `Number of fields in "${table_name}" table is not consistent: `;
    warn_msg += `e.g. record ${record_num_1 + 1} -> ${num_fields_1} fields, record ${record_num_2 + 1} -> ${num_fields_2} fields`;
    return warn_msg;
}


class RbqlIOHandlingError extends Error {}

class VSCodeRecordIterator extends rbql.RBQLInputIterator {
    constructor(document, delim, policy, has_header=false, comment_prefix=null, table_name='input', variable_prefix='a') {
        // We could have done a hack here actually: convert the document to stream/buffer and then use the standard reader.
        super();
        this.has_header = has_header;
        this.table_name = table_name;
        this.variable_prefix = variable_prefix;
        this.NR = 0; // Record number.
        this.NL = 0; // Line number (NL != NR when the CSV file has comments or multiline fields).
        let fail_on_warning = policy == 'quoted_rfc';
        let [_num_records_parsed, _comments] = [null, null];
        [this.records, _num_records_parsed, this.fields_info, this.first_defective_line, this._first_trailing_space_line, _comments] = fast_load_utils.parse_document_records(document, delim, policy, comment_prefix, fail_on_warning);
        if (fail_on_warning && this.first_defective_line !== null) {
            throw new RbqlIOHandlingError(`Inconsistent double quote escaping in ${this.table_name} table at record ${this.records.length}, line ${this.first_defective_line}`);
        }
        this.first_record = this.records.length ? this.records[0] : [];
        this.next_record_index = 0;
    }

    stop() {
    }

    async get_variables_map(query_text) {
        let variable_map = new Object();
        rbql.parse_basic_variables(query_text, this.variable_prefix, variable_map);
        rbql.parse_array_variables(query_text, this.variable_prefix, variable_map);
        if (this.has_header) {
            rbql.parse_attribute_variables(query_text, this.variable_prefix, this.first_record, 'CSV header line', variable_map);
            rbql.parse_dictionary_variables(query_text, this.variable_prefix, this.first_record, variable_map);
        }
        return variable_map;
    }

    async get_header() {
        return this.has_header ? this.first_record : null;
    }

    do_get_record() {
        if (this.next_record_index >= this.records.length) {
            return null;
        }
        let record = this.records[this.next_record_index];
        this.next_record_index += 1;
        return record;
    }

    async get_record() {
        if (this.NR == 0 && this.has_header) {
            this.do_get_record(); // Skip the header record.
        }
        this.NR += 1;
        let record = this.do_get_record();
        return record;
    }

    get_warnings() {
        let result = [];
        if (this.first_defective_line !== null)
            result.push(`Inconsistent double quote escaping in ${this.table_name} table. E.g. at line ${this.first_defective_line}`);
        if (this.fields_info.size > 1)
            result.push(make_inconsistent_num_fields_warning(this.table_name, this.fields_info));
        return result;
    }
}


class VSCodeWriter extends rbql.RBQLOutputWriter {
    constructor(delim, policy) {
        super();
        this.delim = delim;
        this.policy = policy;
        this.header_len = null;
        this.null_in_output = false;
        this.delim_in_simple_output = false;
        this.output_lines = [];

        if (policy == 'simple') {
            this.polymorphic_join = this.simple_join;
        } else if (policy == 'quoted') {
            this.polymorphic_join = this.quoted_join;
        } else if (policy == 'quoted_rfc') {
            this.polymorphic_join = this.quoted_join_rfc;
        } else if (policy == 'monocolumn') {
            this.polymorphic_join = this.mono_join;
        } else if (policy == 'whitespace') {
            this.polymorphic_join = this.simple_join;
        } else {
            throw new RbqlIOHandlingError('Unknown output csv policy');
        }
    }

    set_header(header) {
        if (header !== null) {
            this.header_len = header.length;
            this.write(header);
        }
    }

    quoted_join(fields) {
        let delim = this.delim;
        var quoted_fields = fields.map(function(v) { return csv_utils.quote_field(String(v), delim); });
        return quoted_fields.join(this.delim);
    };


    quoted_join_rfc(fields) {
        let delim = this.delim;
        var quoted_fields = fields.map(function(v) { return csv_utils.rfc_quote_field(String(v), delim); });
        return quoted_fields.join(this.delim);
    };


    mono_join(fields) {
        if (fields.length > 1) {
            throw new RbqlIOHandlingError('Unable to use "Monocolumn" output format: some records have more than one field');
        }
        return fields[0];
    };


    simple_join(fields) {
        var res = fields.join(this.delim);
        if (fields.join('').indexOf(this.delim) != -1) {
            this.delim_in_simple_output = true;
        }
        return res;
    };


    normalize_fields(out_fields) {
        for (var i = 0; i < out_fields.length; i++) {
            if (out_fields[i] == null) {
                this.null_in_output = true;
                out_fields[i] = '';
            } else if (Array.isArray(out_fields[i])) {
                this.normalize_fields(out_fields[i]);
                out_fields[i] = out_fields[i].join(this.sub_array_delim);
            }
        }
    };


    write(fields) {
        if (this.header_len !== null && fields.length != this.header_len)
            throw new RbqlIOHandlingError(`Inconsistent number of columns in output header and the current record: ${this.header_len} != ${fields.length}`);
        this.normalize_fields(fields);
        this.output_lines.push(this.polymorphic_join(fields));
        return true;
    };

    async finish() {
    }

    get_warnings() {
        let result = [];
        if (this.null_in_output)
            result.push('null values in output were replaced by empty strings');
        if (this.delim_in_simple_output)
            result.push('Some output fields contain separator');
        return result;
    };
}

class VSCodeTableRegistry {
    constructor(){}

    get_iterator_by_table_id(_table_id) {
        throw new RbqlIOHandlingError("JOIN queries are currently not supported in vscode.dev web version.");
    }

    get_warnings() {
        return [];
    };
}

async function rbql_query_web(query_text, input_document, input_delim, input_policy, output_delim, output_policy, output_warnings, with_headers, comment_prefix=null) {
    let user_init_code = ''; // TODO find a way to have init code.
    let join_tables_registry = new VSCodeTableRegistry(); // TODO find a way to have join registry.
    let input_iterator = new VSCodeRecordIterator(input_document, input_delim, input_policy, with_headers, comment_prefix);
    let output_writer = new VSCodeWriter(output_delim, output_policy);
    await rbql.query(query_text, input_iterator, output_writer, output_warnings, join_tables_registry, user_init_code);
    return output_writer.output_lines;
}


class VSCodeFileSystemCSVRegistry extends rbql.RBQLTableRegistry {
    constructor(vscode_global_state, input_file_dir, delim, policy, encoding, has_header=false, comment_prefix=null, options=null) {
        super();
        this.vscode_global_state = vscode_global_state;
        this.input_file_dir = input_file_dir;
        this.delim = delim;
        this.policy = policy;
        this.encoding = encoding;
        this.has_header = has_header;
        this.comment_prefix = comment_prefix;
        this.stream = null;
        this.record_iterator = null;

        this.options = options;
        this.bulk_input_path = null;
        this.table_path = null;
    }

    get_iterator_by_table_id(table_id) {
        this.table_path = find_table_path(this.vscode_global_state, this.input_file_dir, table_id);
        if (this.table_path === null) {
            throw new RbqlIOHandlingError(`Unable to find join table "${table_id}"`);
        }
        if (this.options && this.options['bulk_read']) {
            this.bulk_input_path = this.table_path;
        } else {
            this.stream = fs.createReadStream(this.table_path);
        }
        this.record_iterator = new rbql_csv.CSVRecordIterator(this.stream, this.bulk_input_path, this.encoding, this.delim, this.policy, this.has_header, this.comment_prefix, table_id, 'b');
        return this.record_iterator;
    };

    get_warnings(output_warnings) {
        if (this.record_iterator && this.has_header) {
            output_warnings.push(`The first record in JOIN file ${path.basename(this.table_path)} was also treated as header (and skipped)`);
        }
    }
}


async function rbql_query_node(vscode_global_state, query_text, input_path, input_delim, input_policy, output_path, output_delim, output_policy, csv_encoding, output_warnings, with_headers=false, comment_prefix=null, user_init_code='', options=null) {
    let input_stream = null;
    let bulk_input_path = null;
    if (options && options['bulk_read'] && input_path) {
        bulk_input_path = input_path;
    } else {
        input_stream = input_path === null ? process.stdin : fs.createReadStream(input_path);
    }
    let [output_stream, close_output_on_finish] = output_path === null ? [process.stdout, false] : [fs.createWriteStream(output_path), true];
    if (input_delim == '"' && input_policy == 'quoted')
        throw new RbqlIOHandlingError('Double quote delimiter is incompatible with "quoted" policy');
    if (csv_encoding == 'latin-1')
        csv_encoding = 'binary';
    if (!rbql_csv.is_ascii(query_text) && csv_encoding == 'binary')
        throw new RbqlIOHandlingError('To use non-ascii characters in query enable UTF-8 encoding instead of latin-1/binary');
    if ((!rbql_csv.is_ascii(input_delim) || !rbql_csv.is_ascii(output_delim)) && csv_encoding == 'binary')
        throw new RbqlIOHandlingError('To use non-ascii characters in query enable UTF-8 encoding instead of latin-1/binary');

    let default_init_source_path = path.join(os.homedir(), '.rbql_init_source.js');
    if (user_init_code == '' && fs.existsSync(default_init_source_path)) {
        user_init_code = rbql_csv.read_user_init_code(default_init_source_path);
    }
    let input_file_dir = input_path ? path.dirname(input_path) : null;
    let join_tables_registry = new VSCodeFileSystemCSVRegistry(vscode_global_state, input_file_dir, input_delim, input_policy, csv_encoding, with_headers, comment_prefix, options);
    let input_iterator = new rbql_csv.CSVRecordIterator(input_stream, bulk_input_path, csv_encoding, input_delim, input_policy, with_headers, comment_prefix);
    let output_writer = new rbql_csv.CSVWriter(output_stream, close_output_on_finish, csv_encoding, output_delim, output_policy);

    await rbql.query(query_text, input_iterator, output_writer, output_warnings, join_tables_registry, user_init_code);
    join_tables_registry.get_warnings(output_warnings);
}


function make_multiline_record_ranges(vscode, delim_length, newline_marker, fields, start_line, expected_end_line_for_control) {
    // Semantic ranges in VSCode can't span multiple lines, so we use this workaround.
    let record_ranges = [];
    let lnum_current = start_line;
    let pos_in_editor_line = 0;
    let next_pos_in_editor_line = 0;
    for (let i = 0; i < fields.length; i++) {
        let pos_in_logical_field = 0;
        // Group tokens belonging to the same logical field.
        let logical_field_tokens = [];
        while (true) {
            let newline_marker_pos = fields[i].indexOf(newline_marker, pos_in_logical_field);
            if (newline_marker_pos == -1)
                break;
            logical_field_tokens.push(new vscode.Range(lnum_current, pos_in_editor_line, lnum_current, pos_in_editor_line + newline_marker_pos - pos_in_logical_field));
            lnum_current += 1;
            pos_in_editor_line = 0;
            next_pos_in_editor_line = 0;
            pos_in_logical_field = newline_marker_pos + newline_marker.length;
        }
        next_pos_in_editor_line += fields[i].length - pos_in_logical_field;
        if (i + 1 < fields.length) {
            next_pos_in_editor_line += delim_length;
        }
        logical_field_tokens.push(new vscode.Range(lnum_current, pos_in_editor_line, lnum_current, next_pos_in_editor_line));
        record_ranges.push(logical_field_tokens);
        // From semantic tokenization perspective the end of token doesn't include the last character of vscode.Range i.e. it treats the range as [) interval, unlike the Range.contains() function which treats ranges as [] intervals.
        pos_in_editor_line = next_pos_in_editor_line;
    }
    assert(lnum_current == expected_end_line_for_control);
    return record_ranges;
}


function is_opening_rfc_line(line_text, delim) {
    // The line is oppening if by adding a character (to avoid accidental double double quote) and single double quote at the end we can make it parsable without warning!
    // Some lines can be simultaneously opening and closing, e.g. `",a1,a2` or `a1,a2,"`
    let [_record, warning] = csv_utils.split_quoted_str(line_text + 'x"', delim);
    return !warning;
}


function parse_document_range_rfc(vscode, doc, delim, comment_prefix, range, custom_parsing_margin=null) {
    if (custom_parsing_margin === null) {
        custom_parsing_margin = dynamic_csv_highlight_margin;
    }
    let begin_line = Math.max(0, range.start.line - custom_parsing_margin);
    let end_line = Math.min(doc.lineCount, range.end.line + custom_parsing_margin);
    let table_ranges = [];
    let line_aggregator = new csv_utils.MultilineRecordAggregator(comment_prefix);
    // The first or the second line in range with an odd number of double quotes is a start line, after finding it we can use the standard parsing algorithm.
    for (let lnum = begin_line; lnum < end_line; lnum++) {
        let line_text = doc.lineAt(lnum).text;
        if (lnum + 1 == doc.lineCount && !line_text)
            break;
        let inside_multiline_record_before = line_aggregator.is_inside_multiline_record();
        let start_line = lnum - line_aggregator.get_num_lines_in_record();
        line_aggregator.add_line(line_text);
        let inside_multiline_record_after = line_aggregator.is_inside_multiline_record();
        if (!inside_multiline_record_before && inside_multiline_record_after) {
            // Must be an odd-num line, check if this is an openning line - otherwise reset ranges.
            if (!is_opening_rfc_line(line_text, delim)) {
                table_ranges = [];
                line_aggregator.reset();
            }
        }
        if (line_aggregator.has_comment_line) {
            table_ranges.push({comment_range: new vscode.Range(lnum, 0, lnum, line_text.length)});
            line_aggregator.reset();
        } else if (line_aggregator.has_full_record) {
            const newline_marker = '\r\n'; // Use '\r\n' here to guarantee that this sequence is not present anywhere in the lines themselves.
            let combined_line = line_aggregator.get_full_line(newline_marker);
            line_aggregator.reset();
            let [fields, warning] = csv_utils.smart_split(combined_line, delim, QUOTED_POLICY, /*preserve_quotes_and_whitespaces=*/true);
            if (!warning) {
                table_ranges.push({record_ranges: make_multiline_record_ranges(vscode, delim.length, newline_marker, fields, start_line, lnum)});
            }
        }
    }
    return table_ranges;
}


function parse_document_range_single_line(vscode, doc, delim, policy, comment_prefix, range) {
    let table_ranges = [];
    let begin_line = Math.max(0, range.start.line - dynamic_csv_highlight_margin);
    let end_line = Math.min(doc.lineCount, range.end.line + dynamic_csv_highlight_margin);
    for (let lnum = begin_line; lnum < end_line; lnum++) {
        let record_ranges = [];
        let line_text = doc.lineAt(lnum).text;
        if (lnum + 1 == doc.lineCount && !line_text)
            break;
        if (comment_prefix && line_text.startsWith(comment_prefix)) {
            table_ranges.push({comment_range: new vscode.Range(lnum, 0, lnum, line_text.length)});
            continue;
        }
        let split_result = csv_utils.smart_split(line_text, delim, policy, /*preserve_quotes_and_whitespaces=*/true);
        // TODO consider handling comments and warnings
        let fields = split_result[0];
        let cpos = 0;
        let next_cpos = 0;
        for (let i = 0; i < fields.length; i++) {
            next_cpos += fields[i].length;
            if (i + 1 < fields.length) {
                next_cpos += delim.length;
            }
            record_ranges.push([new vscode.Range(lnum, cpos, lnum, next_cpos)]);
            // From semantic tokenization perspective the end of token doesn't include the last character of vscode.Range i.e. it treats the range as [) interval, unlike the Range.contains() function which treats ranges as [] intervals.
            cpos = next_cpos;
        }
        table_ranges.push({record_ranges: record_ranges});
    }
    return table_ranges;
}


function parse_document_range(vscode, doc, delim, policy, comment_prefix, range) {
    if (policy == QUOTED_RFC_POLICY) {
        return parse_document_range_rfc(vscode, doc, delim, comment_prefix, range);
    } else {
        return parse_document_range_single_line(vscode, doc, delim, policy, comment_prefix, range);
    }
}


function get_field_by_line_position(fields, delim_length, query_pos) {
    if (!fields.length)
        return null;
    var col_num = 0;
    var cpos = fields[col_num].length + delim_length;
    while (query_pos > cpos && col_num + 1 < fields.length) {
        col_num += 1;
        cpos = cpos + fields[col_num].length + delim_length;
    }
    return col_num;
}


function get_cursor_position_info_rfc(vscode, document, delim, comment_prefix, position) {
    const hover_parse_margin = 20;
    let range = new vscode.Range(Math.max(position.line - hover_parse_margin, 0), 0, position.line + hover_parse_margin, 0);
    let table_ranges = parse_document_range_rfc(vscode, document, delim, comment_prefix, range);
    let last_found_position_info = null; // Use last found instead of first found because cursor position at the border can belong to two ranges simultaneously.
    for (let row_info of table_ranges) {
        if (row_info.hasOwnProperty('comment_range')) {
            if (row_info.comment_range.contains(position)) {
                last_found_position_info = {is_comment: true};
            }
        } else {
            for (let col_num = 0; col_num < row_info.record_ranges.length; col_num++) {
                // One logical field can map to multiple ranges if it spans multiple lines.
                for (let record_range of row_info.record_ranges[col_num]) {
                    if (record_range.contains(position)) {
                        last_found_position_info = {column_number: col_num, total_columns: row_info.record_ranges.length, split_warning: false};
                    }
                }
            }
        }
    }
    return last_found_position_info;
}


function get_cursor_position_info_standard(document, delim, policy, comment_prefix, position) {
    var lnum = position.line;
    var cnum = position.character;
    var line = document.lineAt(lnum).text;

    if (comment_prefix && line.startsWith(comment_prefix))
        return {is_comment: true};

    let [entries, warning] = csv_utils.smart_split(line, delim, policy, true);
    var col_num = get_field_by_line_position(entries, delim.length, cnum + 1);
    if (col_num == null)
        return null;
    return {column_number: col_num, total_columns: entries.length, split_warning: warning};
}


function get_cursor_position_info(vscode, document, delim, policy, comment_prefix, position) {
    if (policy === null)
        return null;
    if (policy == QUOTED_RFC_POLICY) {
        return get_cursor_position_info_rfc(vscode, document, delim, comment_prefix, position);
    } else {
        return get_cursor_position_info_standard(document, delim, policy, comment_prefix, position);
    }
}


function format_cursor_position_info(cursor_position_info, header, show_column_names, show_comments, max_label_length) {
    if (cursor_position_info.is_comment) {
        if (show_comments) {
            return ['Comment', 'Comment'];
        } else {
            return [null, null];
        }
    }
    let short_report = 'Col ' + (cursor_position_info.column_number + 1);
    let full_report = '[Rainbow CSV] ' + short_report;
    if (show_column_names && cursor_position_info.column_number < header.length) {
        let column_label = header[cursor_position_info.column_number].trim();
        let short_column_label = column_label.substr(0, max_label_length);
        if (short_column_label != column_label)
            short_column_label = short_column_label + '...';
        short_report += ': ' + short_column_label;
        full_report += ': ' + column_label;
    }
    if (cursor_position_info.split_warning) {
        full_report += '; ERR: Inconsistent double quotes in line';
    } else if (header.length != cursor_position_info.total_columns) {
        full_report += `; WARN: Inconsistent num of fields, header: ${header.length}, this line: ${cursor_position_info.total_columns}`;
    }
    return [full_report, short_report];
}


function sample_records(document, delim, policy, comment_prefix, end_record, preview_window_size, stop_on_warning, cached_table_parse_result) {
    let records = [];
    let first_failed_line = null;
    let vscode_doc_version = null;
    let [_num_records_parsed, _fields_info, _first_trailing_space_line, _comments] = [null, null, null, null];
    // Here `preview_window_size` is typically 100.
    if (end_record < preview_window_size * 5) {
        // Re-sample the records. Re-sampling top records is fast and it ensures that all manual changes are mirrored into RBQL console.
        [records, _num_records_parsed, _fields_info, first_failed_line, _first_trailing_space_line, _comments] = fast_load_utils.parse_document_records(document, delim, policy, comment_prefix, stop_on_warning, /*max_records_to_parse=*/end_record, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false);
    } else {
        let need_full_doc_parse = true;
        if (cached_table_parse_result.has(document.fileName)) {
            [records, first_failed_line, vscode_doc_version] = cached_table_parse_result.get(document.fileName);
            if (document.version === vscode_doc_version) {
                need_full_doc_parse = false;
            }
        }
        if (need_full_doc_parse) {
            let [records, _num_records_parsed, _fields_info, first_failed_line, _first_trailing_space_line, _comments] = fast_load_utils.parse_document_records(document, delim, policy, comment_prefix, stop_on_warning, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/false);
            cached_table_parse_result.set(document.fileName, [records, first_failed_line, document.version]);
        }
        [records, first_failed_line, vscode_doc_version] = cached_table_parse_result.get(document.fileName);
    }
    return [records, first_failed_line];
}


function sample_preview_records_from_context(rbql_context, dst_message, preview_window_size, cached_table_parse_result) {
    let [document, delim, policy, comment_prefix] = [rbql_context.input_document, rbql_context.delim, rbql_context.policy, rbql_context.comment_prefix];
    rbql_context.requested_start_record = Math.max(rbql_context.requested_start_record, 0);
    let stop_on_warning = policy == QUOTED_RFC_POLICY;
    let [records, first_failed_line] = sample_records(document, delim, policy, comment_prefix, rbql_context.requested_start_record + preview_window_size, preview_window_size, stop_on_warning, cached_table_parse_result);;
    if (first_failed_line !== null && policy == QUOTED_RFC_POLICY) {
        dst_message.preview_sampling_error = `Double quotes are not consistent in record ${records.length + 1} which starts at line ${first_failed_line + 1}`;
        return;
    }
    rbql_context.requested_start_record = Math.max(0, Math.min(rbql_context.requested_start_record, records.length - preview_window_size));
    let preview_records = records.slice(rbql_context.requested_start_record, rbql_context.requested_start_record + preview_window_size);

    // Here we trim excessively long fields. The only benefit of doing is here instead of UI layer is to minimize the ammount of traffic that we send to UI - the total message size is limited.
    for (let r = 0; r < preview_records.length; r++) {
        let cur_record = preview_records[r];
        for (let c = 0; c < cur_record.length; c++) {
            if (cur_record[c].length > max_preview_field_length) {
                cur_record[c] = cur_record[c].substr(0, max_preview_field_length) + '###UI_STRING_TRIM_MARKER###';
            }
        }
    }
    dst_message.preview_records = preview_records;
    dst_message.actual_start_record = rbql_context.requested_start_record;
}

function show_lint_status_bar_button(vscode, extension_context, file_path, language_id) {

    const COLOR_PROCESSING = '#A0A0A0';
    const COLOR_ERROR      = '#f44242';
    const COLOR_WARNING    = '#ffff28';
    const COLOR_OK         = '#62f442';

    let lint_cache_key = `${file_path}.${language_id}`;

    if (!extension_context.lint_results.has(lint_cache_key)){
      return;
    }

    var lint_report = extension_context.lint_results.get(lint_cache_key);

    if (!extension_context.lint_status_bar_button){
      extension_context.lint_status_bar_button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    }

    extension_context.lint_status_bar_button.text = 'CSVLint';
    let lint_report_msg = '';
    if (lint_report.is_processing) {

        extension_context.lint_status_bar_button.color = COLOR_PROCESSING;
        extension_context.lint_status_bar_button.text = '$(clock) CSVLint';
        lint_report_msg = 'Processing';

    } else if (Number.isInteger(lint_report.first_defective_line)) {

        lint_report_msg = `Error. Line ${lint_report.first_defective_line} has formatting error: double quote chars are not consistent`;
        extension_context.lint_status_bar_button.color = COLOR_ERROR;
        extension_context.lint_status_bar_button.text = '$(error) CSVLint';

    } else if (lint_report.fields_info && lint_report.fields_info.size > 1) {

        let [record_num_1, num_fields_1, record_num_2, num_fields_2] = rbql.sample_first_two_inconsistent_records(lint_report.fields_info);
        lint_report_msg = `Error. Number of fields is not consistent: e.g. record ${record_num_1 + 1} has ${num_fields_1} fields, and record ${record_num_2 + 1} has ${num_fields_2} fields`;
        extension_context.lint_status_bar_button.color = COLOR_ERROR;
        extension_context.lint_status_bar_button.text = '$(error) CSVLint';

    } else if (Number.isInteger(lint_report.first_trailing_space_line)) {

        lint_report_msg = `Leading/Trailing spaces detected: e.g. at line ${lint_report.first_trailing_space_line + 1}. Run "Shrink" command to remove them`;
        extension_context.lint_status_bar_button.color = COLOR_WARNING;
        extension_context.lint_status_bar_button.text = '$(alert) CSVLint';
    } else {
        assert(lint_report.is_ok);
        extension_context.lint_status_bar_button.color = COLOR_OK;
        extension_context.lint_status_bar_button.text = '$(pass) CSVLint';
        lint_report_msg = 'OK';
    }
    extension_context.lint_status_bar_button.tooltip = lint_report_msg + '\nClick to recheck';
    extension_context.lint_status_bar_button.command = 'rainbow-csv.CSVLint';
    extension_context.lint_status_bar_button.show();
}


function generate_column_edit_selections(vscode, active_doc, delim, policy, comment_prefix, edit_mode, col_num) {
    let [records, _num_records_parsed, _fields_info, first_defective_line, _first_trailing_space_line, comments] = fast_load_utils.parse_document_records(active_doc, delim, policy, comment_prefix, /*stop_on_warning=*/true, /*max_records_to_parse=*/-1, /*collect_records=*/true, /*preserve_quotes_and_whitespaces=*/true);
    if (first_defective_line !== null) {
        return [null, `Unable to enter column edit mode: quoting error at line ${first_defective_line + 1}`, null];
    }
    if (records.length + comments.length != active_doc.lineCount) {
        // It is possible to support editing of non-multiline columns in such files, but for simplicity we won't do this.
        return [null, 'Column edit mode is not supported for files with multiline fields', null];
    }
    let lnum = 0;
    let selections = [];
    let warning_msg = null;
    let merger = new RecordCommentMerger(records, comments);
    while (merger.has_entries_left()) {
        let [record, comment] = merger.get_next();
        assert((comment === null) != (record === null));
        if (record !== null) {
            if (col_num >= record.length) {
                return [null, `Line ${lnum + 1} doesn't have field number ${col_num + 1}`, null];
            }
            let char_pos_before = record.slice(0, col_num).join('').length + col_num * delim.length;
            let char_pos_after = record.slice(0, col_num + 1).join('').length + col_num * delim.length;
            let line_text = record.join(delim);
            if (!warning_msg && edit_mode == 'ce_before' && (policy == QUOTED_POLICY || policy == QUOTED_RFC_POLICY) && line_text.substring(char_pos_before - 2, char_pos_before + 2).indexOf('"') != -1) {
                warning_msg = `Be careful, cursor at line ${lnum + 1} has a double quote is in proximity.`;
            }
            if (!warning_msg && edit_mode == 'ce_after' && (policy == QUOTED_POLICY || policy == QUOTED_RFC_POLICY) && line_text.substring(char_pos_after - 2, char_pos_after + 2).indexOf('"') != -1) {
                warning_msg = `Be careful, cursor at line ${lnum + 1} has a double quote is in proximity.`;
            }
            if (!warning_msg && edit_mode == 'ce_select' && char_pos_before == char_pos_after) {
                warning_msg = `Be careful, Field ${col_num + 1} at line ${lnum + 1} is empty.`;
            }
            let position_before = new vscode.Position(lnum, char_pos_before);
            let position_after = new vscode.Position(lnum, char_pos_after);
            if (edit_mode == 'ce_before') {
                selections.push(new vscode.Selection(position_before, position_before));
            }
            if (edit_mode == 'ce_after') {
                selections.push(new vscode.Selection(position_after, position_after));
            }
            if (edit_mode == 'ce_select') {
                selections.push(new vscode.Selection(position_before, position_after));
            }
        }
        lnum += 1;
    }
    return [selections, null, warning_msg];
}


module.exports.make_table_name_key = make_table_name_key;
module.exports.find_table_path = find_table_path;
module.exports.read_header = read_header;
module.exports.rbql_query_web = rbql_query_web;
module.exports.rbql_query_node = rbql_query_node;
module.exports.get_header_line = get_header_line;
module.exports.get_default_js_udf_content = get_default_js_udf_content;
module.exports.get_default_python_udf_content = get_default_python_udf_content;
module.exports.align_columns = align_columns;
module.exports.shrink_columns = shrink_columns;
module.exports.calc_column_stats = calc_column_stats;
module.exports.adjust_column_stats = adjust_column_stats;
module.exports.update_subcomponent_stats = update_subcomponent_stats;
module.exports.align_field = align_field;
module.exports.rfc_align_field = rfc_align_field;
module.exports.assert = assert;
module.exports.get_field_by_line_position = get_field_by_line_position;
module.exports.get_cursor_position_info = get_cursor_position_info;
module.exports.format_cursor_position_info = format_cursor_position_info;
module.exports.parse_document_range = parse_document_range;
module.exports.sample_preview_records_from_context = sample_preview_records_from_context;
module.exports.parse_document_range_rfc = parse_document_range_rfc; // Only for unit tests.
module.exports.sample_first_two_inconsistent_records = rbql.sample_first_two_inconsistent_records;
module.exports.is_opening_rfc_line = is_opening_rfc_line; // Only for unit tests.
module.exports.show_lint_status_bar_button = show_lint_status_bar_button;
module.exports.get_cursor_position_if_unambiguous = get_cursor_position_if_unambiguous;
module.exports.RecordCommentMerger = RecordCommentMerger;
module.exports.generate_column_edit_selections = generate_column_edit_selections;
