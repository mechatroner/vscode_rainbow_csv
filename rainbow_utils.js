const os = require('os');
const fs = require('fs');
const path = require('path');

const rbql = require('./rbql_core/rbql-js/rbql.js');
const rbql_csv = require('./rbql_core/rbql-js/rbql_csv.js');
const csv_utils = require('./rbql_core/rbql-js/csv_utils.js');

const non_numeric_sentinel = -1;
const number_regex = /^([0-9]+)(\.[0-9]+)?$/;

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
    // Write your own functions bellow this line:
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
    # Write your own functions bellow this line:
    `.replace(new RegExp(/^  */, 'mg'), '');
    return default_content;
}


function update_subcomponent_stats(field, is_first_line, max_field_components_lens) {
    // Extract overall field length and length of integer and fractional parts of the field if it represents a number.
    // Here `max_field_components_lens` is a tuple: (max_field_length, max_integer_part_length, max_fractional_part_length)
    if (field.length > max_field_components_lens[0]) {
        max_field_components_lens[0] = field.length;
    }
    if (max_field_components_lens[1] == non_numeric_sentinel) {
        // Column is not a number, early return.
        return;
    }
    let match_result = number_regex.exec(field);
    if (match_result === null) {
        if (!is_first_line && field.length) { // Checking field_length here allows numeric columns to have some of the fields empty.
            // We only mark the column as non-header if we know that this is not a header line.
            max_field_components_lens[1] = non_numeric_sentinel;
            max_field_components_lens[2] = non_numeric_sentinel;
        }
        return;
    }
    let cur_integer_part_length = match_result[1].length;
    max_field_components_lens[1] = Math.max(max_field_components_lens[1], cur_integer_part_length);
    let cur_fractional_part_length = match_result[2] === undefined ? 0 : match_result[2].length;
    max_field_components_lens[2] = Math.max(max_field_components_lens[2], cur_fractional_part_length);
}


function calc_column_stats(active_doc, delim, policy, comment_prefix) {
    let column_stats = [];
    let num_lines = active_doc.lineCount;
    let is_first_line = true;
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (comment_prefix && line_text.startsWith(comment_prefix))
            continue;
        let [fields, warning] = csv_utils.smart_split(line_text, delim, policy, true);
        if (warning) {
            return [null, lnum + 1];
        }
        for (let fnum = 0; fnum < fields.length; fnum++) {
            let field = fields[fnum].trim();
            if (column_stats.length <= fnum) {
                column_stats.push([0, 0, 0]);
            }
            update_subcomponent_stats(field, is_first_line, column_stats[fnum]);
        }
        is_first_line = false;
    }
    return [column_stats, null];
}


function adjust_column_stats(column_stats) {
    // Ensure that numeric components max widths are consistent with non-numeric (header) width.
    let adjusted_stats = [];
    for (let column_stat of column_stats) {
        if (column_stat[1] <= 0) {
            column_stat[1] = -1;
            column_stat[2] = -1;
        }
        if (column_stat[1] > 0) {
            // The sum of integer and float parts can be bigger than the max width, e.g. here:
            // value
            // 0.12
            // 1234
            if (column_stat[1] + column_stat[2] > column_stat[0]) {
                column_stat[0] = column_stat[1] + column_stat[2];
            }
            // This is needed when the header is wider than numeric components and/or their sum.
            if (column_stat[0] - column_stat[2] > column_stat[1]) {
                column_stat[1] = column_stat[0] - column_stat[2];
            }
            // Sanity check.
            if (column_stat[0] != column_stat[1] + column_stat[2]) {
                // Assertion Error, this can never happen.
                return null;
            }
        }
        adjusted_stats.push(column_stat);
    }
    return adjusted_stats;
}


function align_field(field, is_first_line, max_field_components_lens, is_last_column) {
    // Align field, use Math.max() to avoid negative delta_length which can happen theorethically due to async doc edit.
    const extra_readability_whitespace_length = 1;
    field = field.trim();
    if (max_field_components_lens[1] == non_numeric_sentinel) {
        let delta_length = Math.max(max_field_components_lens[0] - field.length, 0);
        return is_last_column ? field : field + ' '.repeat(delta_length + extra_readability_whitespace_length);
    }
    if (is_first_line) {
        if (number_regex.exec(field) === null) {
            // The line must be a header - align it using max_width rule.
            let delta_length = Math.max(max_field_components_lens[0] - field.length, 0);
            return is_last_column ? field : field + ' '.repeat(delta_length + extra_readability_whitespace_length);
        }
    }
    let dot_pos = field.indexOf('.');
    let cur_integer_part_length = dot_pos == -1 ? field.length : dot_pos;
    // Here cur_fractional_part_length includes the leading dot too.
    let cur_fractional_part_length = dot_pos == -1 ? 0 : field.length - dot_pos;
    let integer_delta_length = Math.max(max_field_components_lens[1] - cur_integer_part_length, 0);
    let fractional_delta_length = Math.max(max_field_components_lens[2] - cur_fractional_part_length);
    let trailing_spaces = is_last_column ? '' : ' '.repeat(fractional_delta_length + extra_readability_whitespace_length);
    return ' '.repeat(integer_delta_length) + field + trailing_spaces;
}


function align_columns(active_doc, delim, policy, comment_prefix, column_stats) {
    let result_lines = [];
    let num_lines = active_doc.lineCount;
    let has_edit = false;
    let is_first_line = true;
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (comment_prefix && line_text.startsWith(comment_prefix)) {
            result_lines.push(line_text);
            continue;
        }
        if (lnum + 1 == num_lines && line_text == '') {
            // Skip the last empty line which corresponds to the trailing newline character.
            result_lines.push(line_text);
            continue;
        }
        let fields = csv_utils.smart_split(line_text, delim, policy, true)[0];
        for (let fnum = 0; fnum < fields.length; fnum++) {
            if (fnum >= column_stats.length) // Safeguard against async doc edit, should never happen.
                break;
            let is_last_column = fnum + 1 == column_stats.length;
            let adjusted = align_field(fields[fnum], is_first_line, column_stats[fnum], is_last_column);
            if (fields[fnum] != adjusted) {
                fields[fnum] = adjusted;
                has_edit = true;
            }
        }
        is_first_line = false;
        result_lines.push(fields.join(delim));
    }
    if (!has_edit)
        return null;
    return result_lines.join('\n');
}


function shrink_columns(active_doc, delim, policy, comment_prefix) {
    let result_lines = [];
    let num_lines = active_doc.lineCount;
    let has_edit = false;
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (comment_prefix && line_text.startsWith(comment_prefix)) {
            result_lines.push(line_text);
            continue;
        }
        let [fields, warning] = csv_utils.smart_split(line_text, delim, policy, true);
        if (warning) {
            return [null, lnum + 1];
        }
        for (let i = 0; i < fields.length; i++) {
            let adjusted = fields[i].trim();
            if (fields[i].length != adjusted.length) {
                fields[i] = adjusted;
                has_edit = true;
            }
        }
        result_lines.push(fields.join(delim));
    }
    if (!has_edit)
        return [null, null];
    return [result_lines.join('\n'), null];
}


function get_last(arr) {
    return arr[arr.length - 1];
}


function populate_optimistic_rfc_csv_record_map(document, requested_end_record, dst_record_map, comment_prefix=null) {
    let num_lines = document.lineCount;
    let record_begin = null;
    let start_line_idx = dst_record_map.length ? get_last(dst_record_map)[1] : 0;
    for (let lnum = start_line_idx; lnum < num_lines && dst_record_map.length < requested_end_record; ++lnum) {
        let line_text = document.lineAt(lnum).text;
        if (lnum + 1 >= num_lines && line_text == "")
            break; // Skip the last empty line.
        if (comment_prefix && line_text.startsWith(comment_prefix))
            continue;
        let match_list = line_text.match(/"/g);
        let has_unbalanced_double_quote = match_list && match_list.length % 2 == 1;
        if (record_begin === null && !has_unbalanced_double_quote) {
            dst_record_map.push([lnum, lnum + 1]);
        } else if (record_begin === null && has_unbalanced_double_quote) {
            record_begin = lnum;
        } else if (!has_unbalanced_double_quote) {
            continue;
        } else {
            dst_record_map.push([record_begin, lnum + 1]);
            record_begin = null;
        }
    }
    if (record_begin !== null) {
        dst_record_map.push([record_begin, num_lines]);
    }
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
            return line_text;
        }
    }
    return null;
}


function make_inconsistent_num_fields_warning(table_name, inconsistent_records_info) {
    let keys = Object.keys(inconsistent_records_info);
    let entries = [];
    for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        let record_id = inconsistent_records_info[key];
        entries.push([record_id, key]);
    }
    entries.sort(function(a, b) { return a[0] - b[0]; });
    assert(entries.length > 1);
    let [record_1, num_fields_1] = entries[0];
    let [record_2, num_fields_2] = entries[1];
    let warn_msg = `Number of fields in "${table_name}" table is not consistent: `;
    warn_msg += `e.g. record ${record_1} -> ${num_fields_1} fields, record ${record_2} -> ${num_fields_2} fields`;
    return warn_msg;
}



class RbqlIOHandlingError extends Error {}

class VSCodeRecordIterator extends rbql.RBQLInputIterator {
    constructor(document, delim, policy, has_header=false, comment_prefix=null, table_name='input', variable_prefix='a') {
        // We could have done a hack here actually: convert the document to stream/buffer and then use the standard reader.
        super();
        this.document = document;
        this.delim = delim;
        this.policy = policy;
        this.has_header = has_header;
        this.comment_prefix = comment_prefix;
        this.table_name = table_name;
        this.variable_prefix = variable_prefix;
        this.NR = 0; // Record number.
        this.NL = 0; // Line number (NL != NR when the CSV file has comments or multiline fields).
        this.fields_info = new Object();
        this.first_defective_line = null;
        this.first_record = this.get_first_record();
    }

    stop() {
    }

    get_first_record() {
        let header_line = get_header_line(this.document, this.comment_prefix);
        let first_record = csv_utils.smart_split(header_line, this.delim, this.policy, /*preserve_quotes_and_whitespaces=*/false)[0];
        return first_record;
    }

    async get_variables_map(query_text) {
        let variable_map = new Object();
        rbql.parse_basic_variables(query_text, this.variable_prefix, variable_map);
        rbql.parse_array_variables(query_text, this.variable_prefix, variable_map);
        let header_line = get_header_line(this.document, this.comment_prefix);
        let first_record = csv_utils.smart_split(header_line, this.delim, this.policy, /*preserve_quotes_and_whitespaces=*/false)[0];
        if (this.has_header) {
            rbql.parse_attribute_variables(query_text, this.variable_prefix, first_record, 'CSV header line', variable_map);
            rbql.parse_dictionary_variables(query_text, this.variable_prefix, first_record, variable_map);
        }
        return variable_map;
    }

    async get_header() {
        return this.has_header ? this.first_record : null;
    }

    get_line_rfc() {
        let rfc_line_buffer = [];
        const num_lines = this.document.lineCount;
        while (this.NL < num_lines) {
            let line = this.document.lineAt(this.NL).text;
            this.NL += 1;
            if (this.NL == num_lines && line.length == 0)
                return null; // Skip the last line if it is empty - this can happen due to trailing newline.
            let record_line = csv_utils.accumulate_rfc_line_into_record(rfc_line_buffer, line, this.comment_prefix);
            if (record_line !== null)
                return record_line;
        }
        return null;
    }

    get_line_simple() {
        const num_lines = this.document.lineCount;
        while (this.NL < num_lines) {
            let line = this.document.lineAt(this.NL).text;
            this.NL += 1;
            if (this.NL == num_lines && line.length == 0)
                return null; // Skip the last line if it is empty - this can happen due to trailing newline.
            if (this.comment_prefix === null || !line.startsWith(this.comment_prefix))
                return line;
        }
        return null;
    }

    do_get_record() {
        let line = (this.policy == 'quoted_rfc') ? this.get_line_rfc() : this.get_line_simple();
        if (line === null)
            return null;
        let [record, warning] = csv_utils.smart_split(line, this.delim, this.policy, /*preserve_quotes_and_whitespaces=*/false);
        if (warning) {
            if (this.first_defective_line === null) {
                this.first_defective_line = this.NL;
                if (this.policy == 'quoted_rfc')
                    throw new RbqlIOHandlingError(`Inconsistent double quote escaping in ${this.table_name} table at record ${this.NR}, line ${this.NL}`);
            }
        }
        let num_fields = record.length;
        if (!this.fields_info.hasOwnProperty(num_fields))
            this.fields_info[num_fields] = this.NR;
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
        if (Object.keys(this.fields_info).length > 1)
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


module.exports.make_table_name_key = make_table_name_key;
module.exports.find_table_path = find_table_path;
module.exports.read_header = read_header;
module.exports.rbql_query_web = rbql_query_web;
module.exports.rbql_query_node = rbql_query_node;
module.exports.get_header_line = get_header_line;
module.exports.populate_optimistic_rfc_csv_record_map = populate_optimistic_rfc_csv_record_map;
module.exports.get_default_js_udf_content = get_default_js_udf_content;
module.exports.get_default_python_udf_content = get_default_python_udf_content;
module.exports.align_columns = align_columns;
module.exports.shrink_columns = shrink_columns;
module.exports.calc_column_stats = calc_column_stats;
module.exports.adjust_column_stats = adjust_column_stats;
module.exports.update_subcomponent_stats = update_subcomponent_stats;
module.exports.align_field = align_field;
