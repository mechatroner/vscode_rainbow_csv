const os = require('os');
const fs = require('fs');
const path = require('path');
const rbql = require('./rbql_core/rbql-js/rbql.js');

const vscode = require('vscode');

const csv_utils = require('./rbql_core/rbql-js/csv_utils.js');


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


function read_header(table_path, encoding, process_header_line_callback) {
    if (encoding == 'latin-1')
        encoding = 'binary';
    let readline = require('readline');
    let input_reader = readline.createInterface({ input: fs.createReadStream(table_path, {encoding: encoding}) });
    let closed = false;
    input_reader.on('line', line => {
        if (!closed) {
            closed = true;
            input_reader.close();
            process_header_line_callback(line);
        }
    });
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
    rbql.assert(entries.length > 1);
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
        // FIXME
        //let rfc_line_buffer = 0;
        //if (this.comment_prefix !== null && this.rfc_line_buffer.length == 0 && line.startsWith(this.comment_prefix))
        //    return; // Just skip the line
        //let match_list = line.match(/"/g);
        //let has_unbalanced_double_quote = match_list && match_list.length % 2 == 1;
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
                    this.handle_exception(new RbqlIOHandlingError(`Inconsistent double quote escaping in ${this.table_name} table at record ${this.NR}, line ${this.NL}`));
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
            result.push(make_inconsistent_num_fields_warning('input', this.fields_info));
        return result;
    }
}


class VSCodeWriter extends rbql.RBQLOutputWriter {
    constructor(delim, policy, vscode_language_name) {
        super();
        this.delim = delim;
        this.policy = policy;
        this.vscode_language_name = vscode_language_name; // Completely determined by the (delim, policy) pair.
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
        let output_doc_cfg = {content: this.output_lines.join('\n'), language: this.vscode_language_name};
        vscode.workspace.openTextDocument(output_doc_cfg).then(doc => vscode.window.showTextDocument(doc));
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


async function query_vscode(query_text, input_document, input_delim, input_policy, output_delim, output_policy, output_vscode_language_name, output_warnings, with_headers, comment_prefix=null) {
    let user_init_code = ''; // TODO find a way to have init code.
    let join_tables_registry = null; // TODO find a way to have join registry.
    let input_iterator = VSCodeRecordIterator(input_document, input_delim, input_policy, with_headers, comment_prefix);
    let output_writer = VSCodeWriter(output_delim, output_policy, output_vscode_language_name);
    await rbql.query(query_text, input_iterator, output_writer, output_warnings, join_tables_registry, user_init_code);
}


module.exports.write_table_name = write_table_name;
module.exports.read_table_path = read_table_path;
module.exports.read_header = read_header;
module.exports.query_vscode = query_vscode;
module.exports.get_header_line = get_header_line;
