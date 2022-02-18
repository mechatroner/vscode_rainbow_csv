const os = require('os');
const fs = require('fs');
const path = require('path');
const rbql = require('./rbql_core/rbql-js/rbql.js');

const vscode = require('vscode');

const csv_utils = require('./rbql_core/rbql-js/csv_utils.js');


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


function calc_column_sizes(active_doc, delim, policy) {
    let result = [];
    let num_lines = active_doc.lineCount;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix = config ? config.get('comment_prefix') : '';
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (comment_prefix && line_text.startsWith(comment_prefix))
            continue;
        let [fields, warning] = csv_utils.smart_split(line_text, delim, policy, true);
        if (warning) {
            return [null, lnum + 1];
        }
        for (let i = 0; i < fields.length; i++) {
            if (result.length <= i)
                result.push(0);
            result[i] = Math.max(result[i], (fields[i].trim()).length);
        }
    }
    return [result, null];
}


function align_columns(active_doc, delim, policy, column_sizes) {
    let result_lines = [];
    let num_lines = active_doc.lineCount;
    let has_edit = false;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix = config ? config.get('comment_prefix') : '';
    for (let lnum = 0; lnum < num_lines; lnum++) {
        let line_text = active_doc.lineAt(lnum).text;
        if (comment_prefix && line_text.startsWith(comment_prefix)) {
            result_lines.push(line_text);
            continue;
        }
        let fields = csv_utils.smart_split(line_text, delim, policy, true)[0];
        for (let i = 0; i < fields.length - 1; i++) {
            if (i >= column_sizes.length) // Safeguard against async doc edit.
                break;
            let adjusted = fields[i].trim();
            let delta_len = column_sizes[i] - adjusted.length;
            if (delta_len >= 0) { // Safeguard against async doc edit.
                adjusted += ' '.repeat(delta_len + 1);
            }
            if (fields[i] != adjusted) {
                fields[i] = adjusted;
                has_edit = true;
            }
        }
        result_lines.push(fields.join(delim));
    }
    if (!has_edit)
        return null;
    return result_lines.join('\n');
}


function shrink_columns(active_doc, delim, policy) {
    let result_lines = [];
    let num_lines = active_doc.lineCount;
    let has_edit = false;
    const config = vscode.workspace.getConfiguration('rainbow_csv');
    let comment_prefix = config ? config.get('comment_prefix') : '';
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


function update_records(records, record_key, new_record) {
    for (var i = 0; i < records.length; i++) {
        if (records[i].length && records[i][0] == record_key) {
            records[i] = new_record;
            return;
        }
    }
    records.push(new_record);
}


function try_read_index(index_path) {
    var content = null;
    try {
        content = fs.readFileSync(index_path, 'utf-8');
    } catch (e) {
        return [];
    }
    var lines = content.split('\n');
    var records = [];
    for (var i = 0; i < lines.length; i++) {
        if (!lines[i])
            continue;
        var record = lines[i].split('\t');
        records.push(record);
    }
    return records;
}


function write_index(records, index_path) {
    var lines = [];
    for (var i = 0; i < records.length; i++) {
        lines.push(records[i].join('\t'));
    }
    fs.writeFileSync(index_path, lines.join('\n'));
}


function write_table_name(table_path, table_name) {
    // TODO use VSCode "globalState" persistent storage instead with new RBQL version
    let home_dir = os.homedir();
    let index_path = path.join(home_dir, '.rbql_table_names');
    let records = try_read_index(index_path);
    let new_record = [table_name, table_path];
    update_records(records, table_name, new_record);
    if (records.length > 100) {
        records.splice(0, 1);
    }
    write_index(records, index_path);
}


function read_table_path(table_name) {
    let home_dir = os.homedir();
    let index_path = path.join(home_dir, '.rbql_table_names');
    let records = try_read_index(index_path);
    for (let record of records) {
        if (record.length > 1 && record[0] === table_name) {
            return record[1];
        }
    }
    if (fs.existsSync(table_name))
        return table_name;
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

async function query_vscode(query_text, input_document, input_delim, input_policy, output_delim, output_policy, output_warnings, with_headers, comment_prefix=null) {
    let user_init_code = ''; // TODO find a way to have init code.
    let join_tables_registry = new VSCodeTableRegistry(); // TODO find a way to have join registry.
    let input_iterator = new VSCodeRecordIterator(input_document, input_delim, input_policy, with_headers, comment_prefix);
    let output_writer = new VSCodeWriter(output_delim, output_policy);
    await rbql.query(query_text, input_iterator, output_writer, output_warnings, join_tables_registry, user_init_code);
    return output_writer.output_lines;
}


module.exports.write_table_name = write_table_name;
module.exports.read_table_path = read_table_path;
module.exports.read_header = read_header;
module.exports.query_vscode = query_vscode;
module.exports.get_header_line = get_header_line;
module.exports.populate_optimistic_rfc_csv_record_map = populate_optimistic_rfc_csv_record_map;
module.exports.get_default_js_udf_content = get_default_js_udf_content;
module.exports.get_default_python_udf_content = get_default_python_udf_content;
module.exports.align_columns = align_columns;
module.exports.shrink_columns = shrink_columns;
module.exports.calc_column_sizes = calc_column_sizes;
