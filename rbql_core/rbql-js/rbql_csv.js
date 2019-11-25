const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const rbql = require('./rbql.js');
const csv_utils = require('./csv_utils.js');

var debug_mode = false;

class RbqlIOHandlingError extends Error {}
class RbqlParsingError extends Error {}
class AssertionError extends Error {}


// TODO performance improvement: replace smart_split() with polymorphic_split()


function assert(condition, message=null) {
    if (!condition) {
        if (!message) {
            message = 'Assertion error';
        }
        throw new AssertionError(message);
    }
}


function interpret_named_csv_format(format_name) {
    format_name = format_name.toLowerCase();
    if (format_name == 'monocolumn')
        return ['', 'monocolumn'];
    if (format_name == 'csv')
        return [',', 'quoted'];
    if (format_name == 'tsv')
        return ['\t', 'simple'];
    throw new RbqlIOHandlingError(`Unknown format name: "${format_name}"`);
}



function is_ascii(str) {
    return /^[\x00-\x7F]*$/.test(str);
}


function read_user_init_code(rbql_init_source_path) {
    return fs.readFileSync(rbql_init_source_path, 'utf-8');
}


function remove_utf8_bom(line, assumed_source_encoding) {
    if (assumed_source_encoding == 'binary' && line.length >= 3 && line.charCodeAt(0) === 0xEF && line.charCodeAt(1) === 0xBB && line.charCodeAt(2) === 0xBF) {
        return line.substring(3);
    }
    if (assumed_source_encoding == 'utf-8' && line.length >= 1 && line.charCodeAt(0) === 0xFEFF) {
        return line.substring(1);
    }
    return line;
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


function expanduser(filepath) {
    if (filepath.charAt(0) === '~') {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
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


function get_index_record(index_path, key) {
    var records = try_read_index(index_path);
    for (var i = 0; i < records.length; i++) {
        if (records[i].length && records[i][0] == key) {
            return records[i];
        }
    }
    return null;
}


function find_table_path(table_id) {
    var candidate_path = expanduser(table_id);
    if (fs.existsSync(candidate_path)) {
        return candidate_path;
    }
    let table_names_settings_path = path.join(os.homedir(), '.rbql_table_names');
    var name_record = get_index_record(table_names_settings_path, table_id);
    if (name_record && name_record.length > 1 && fs.existsSync(name_record[1])) {
        return name_record[1];
    }
    return null;
}


class RecordQueue {
    constructor() {
        this.push_stack = [];
        this.pull_stack = [];
    }

    enqueue(record) {
        this.push_stack.push(record);
    }

    dequeue() {
        if (!this.pull_stack.length) {
            if (!this.push_stack.length)
                return null;
            this.pull_stack = this.push_stack;
            this.pull_stack.reverse();
            this.push_stack = [];
        }
        return this.pull_stack.pop();
    }

    return_to_pull_stack(record) {
        this.pull_stack.push(record);
    }
}


function js_string_escape_column_name(column_name, quote_char) {
    column_name = column_name.replace(/\\/g, '\\\\');
    if (quote_char === "'")
        return column_name.replace(/'/g, "\\'");
    if (quote_char === '"')
        return column_name.replace(/"/g, '\\"');
    assert(quote_char === "`");
    return column_name.replace(/`/g, "\\`");
}


function parse_dictionary_variables(query, prefix, header_columns_names, dst_variables_map) {
    // The purpose of this algorithm is to minimize number of variables in varibale_map to improve performance, ideally it should be only variables from the query

    // FIXME to prevent typos in attribute names either use query-based variable parsing which can properly handle back-tick strings or wrap "a" and "b" variables with ES6 Proxies https://stackoverflow.com/a/25658975/2898283
    assert(prefix === 'a' || prefix === 'b');
    let dict_test_rgx = new RegExp(`(?:^|[^_a-zA-Z0-9])${prefix}\\[`);
    if (query.search(dict_test_rgx) == -1)
        return;
    let rgx = new RegExp('[-a-zA-Z0-9_:;+=!.,()%^#@&* ]+', 'g');
    for (let i = 0; i < header_columns_names.length; i++) {
        let column_name = header_columns_names[i];
        let continuous_name_segments = rbql.get_all_matches(rgx, column_name);
        let add_column_name = true;
        for (let continuous_segment of continuous_name_segments) {
            if (query.indexOf(continuous_segment) == -1) {
                add_column_name = false;
                break;
            }
        }
        if (add_column_name) {
            let escaped_column_name = js_string_escape_column_name(column_name, '"');
            dst_variables_map[`${prefix}["${escaped_column_name}"]`] = {initialize: true, index: i};
            escaped_column_name = js_string_escape_column_name(column_name, "'");
            dst_variables_map[`${prefix}['${escaped_column_name}']`] = {initialize: false, index: i};
            escaped_column_name = js_string_escape_column_name(column_name, "`");
            dst_variables_map[`${prefix}[\`${escaped_column_name}\`]`] = {initialize: false, index: i};
        }
    }
}


function parse_attribute_variables(query, prefix, header_columns_names, dst_variables_map) {
    // The purpose of this algorithm is to minimize number of variables in varibale_map to improve performance, ideally it should be only variables from the query

    assert(prefix === 'a' || prefix === 'b');
    let rgx = new RegExp(`(?:^|[^_a-zA-Z0-9])${prefix}\\.([_a-zA-Z][_a-zA-Z0-9]*)`, 'g');
    let matches = rbql.get_all_matches(rgx, query);
    let column_names = matches.map(v => v[1]);
    for (let column_name of column_names) {
        let zero_based_idx = header_columns_names.indexOf(column_name);
        if (zero_based_idx != -1) {
            dst_variables_map[`${prefix}.${column_name}`] = {initialize: true, index: zero_based_idx};
        } else {
            throw new RbqlParsingError(`Unable to find column "${column_name}" in ${prefix == 'a' ? 'input' : 'join'} CSV header line`);
        }
    }
}



function CSVRecordIterator(stream, encoding, delim, policy, table_name='input', variable_prefix='a') {
    // CSVRecordIterator implements typical async producer-consumer model with an internal buffer:
    // get_record() - consumer
    // stream.on('data') - producer

    this.stream = stream;
    this.encoding = encoding;
    this.delim = delim;
    this.policy = policy;
    this.table_name = table_name;
    this.variable_prefix = variable_prefix;

    this.collect_debug_stats = false;
    this.dbg_stats_num_chunks_got = 0;
    this.dbg_stats_max_records = 0;

    this.decoder = null;
    if (encoding == 'utf-8')
        this.decoder = new util.TextDecoder(encoding, {fatal: true, stream: true});

    this.input_exhausted = false;
    this.started = false;

    this.utf8_bom_removed = false; // BOM doesn't get automatically removed by decoder when utf-8 file is treated as latin-1
    this.first_defective_line = null;

    this.fields_info = new Object();
    this.NR = 0; // Record num
    this.NL = 0; // Line num (can be different from record num for rfc dialect)

    this.rfc_line_buffer = [];

    this.partially_decoded_line = '';

    this.resolve_current_record = null;
    this.reject_current_record = null;
    this.current_exception = null;

    this.produced_records_queue = new RecordQueue();

    this.handle_exception = function(exception) {
        if (this.reject_current_record) {
            let reject = this.reject_current_record;
            this.reject_current_record = null;
            this.resolve_current_record = null;
            reject(exception);
        } else {
            this.current_exception = exception;
        }

    }

    this.preread_header = async function() {
        let header_record = await this.get_record();
        if (header_record === null)
            return null;
        this.produced_records_queue.return_to_pull_stack(header_record);
        this.stream.pause();
        return header_record.slice();
    };


    this.get_variables_map = async function(query) {
        let variable_map = new Object();
        rbql.parse_basic_variables(query, this.variable_prefix, variable_map);
        rbql.parse_array_variables(query, this.variable_prefix, variable_map);

        let header_record = await this.preread_header(); // TODO optimize: do not start the stream if query doesn't seem to have dictionary or attribute -looking patterns
        if (header_record) {
            parse_attribute_variables(query, this.variable_prefix, header_record, variable_map);
            parse_dictionary_variables(query, this.variable_prefix, header_record, variable_map);
        }
        return variable_map;
    };


    this.try_resolve_next_record = function() {
        if (this.resolve_current_record === null)
            return;
        let record = this.produced_records_queue.dequeue();
        if (record === null && !this.input_exhausted)
            return;
        let resolve = this.resolve_current_record;
        this.resolve_current_record = null;
        this.reject_current_record = null;
        resolve(record);
    };


    this.get_record = async function() {
        if (!this.started)
            this.start();
        if (this.stream.isPaused())
            this.stream.resume();

        let parent_iterator = this;
        let current_record_promise = new Promise(function(resolve, reject) {
            parent_iterator.resolve_current_record = resolve;
            parent_iterator.reject_current_record = reject;
        });
        if (this.current_exception) {
            this.reject_current_record(this.current_exception);
            return;
        }
        this.try_resolve_next_record();
        return current_record_promise;
    };


    this.get_all_records = async function(num_records=null) {
        let records = [];
        while (true) {
            let record = await this.get_record();
            if (record === null)
                break;
            records.push(record);
            if (num_records && records.length >= num_records) {
                this.stop();
                break;
            }
        }
        return records;
    };


    this._do_process_line_simple = function(line) {
        this.NR += 1;
        var [record, warning] = csv_utils.smart_split(line, this.delim, this.policy, false);
        if (warning && this.first_defective_line === null)
            this.first_defective_line = this.NR;
        let num_fields = record.length;
        if (!this.fields_info.hasOwnProperty(num_fields))
            this.fields_info[num_fields] = this.NR;
        this.produced_records_queue.enqueue(record);
        this.try_resolve_next_record();
    };


    this._do_process_line_rfc = function(line) {
        let match_list = line.match(/"/g);
        let has_unbalanced_double_quote = match_list && match_list.length % 2 == 1;
        if (this.rfc_line_buffer.length == 0 && !has_unbalanced_double_quote) {
            this._do_process_line_simple(line);
        } else if (this.rfc_line_buffer.length == 0 && has_unbalanced_double_quote) {
            this.rfc_line_buffer.push(line);
        } else if (this.rfc_line_buffer.length != 0 && !has_unbalanced_double_quote) {
            this.rfc_line_buffer.push(line);
        } else {
            this.rfc_line_buffer.push(line);
            let multiline_row = this.rfc_line_buffer.join('\n');
            this.rfc_line_buffer = [];
            this._do_process_line_simple(multiline_row);
        }
    };


    this._do_process_line_polymorphic = policy == 'quoted_rfc' ? this._do_process_line_rfc : this._do_process_line_simple;


    this.process_line = function(line) {
        if (this.NL === 0) {
            var clean_line = remove_utf8_bom(line, this.encoding);
            if (clean_line != line) {
                line = clean_line;
                this.utf8_bom_removed = true;
            }
        }
        this.NL += 1;
        this._do_process_line_polymorphic(line);
    };


    this.process_data_chunk = function(data_chunk) {
        let decoded_string = null;
        if (this.decoder) {
            try {
                decoded_string = this.decoder.decode(data_chunk);
            } catch (e) {
                if (e instanceof TypeError) {
                    this.handle_exception(new RbqlIOHandlingError('Unable to decode input table as UTF-8. Use binary (latin-1) encoding instead'));
                } else {
                    this.handle_exception(e);
                }
                return;
            }
        } else {
            decoded_string = data_chunk.toString(this.encoding);
        }
        let lines = csv_utils.split_lines(decoded_string);
        lines[0] = this.partially_decoded_line + lines[0];
        this.partially_decoded_line = lines.pop();
        for (let i = 0; i < lines.length; i++) {
            this.process_line(lines[i]);
        }

        if (this.collect_debug_stats) {
            this.dbg_stats_num_chunks_got += 1;
            this.dbg_stats_max_records = Math.max(this.dbg_stats_max_records, this.produced_records_queue.push_stack.length + this.produced_records_queue.pull_stack.length);
        }
    };


    this.process_data_end = function() {
        this.input_exhausted = true;
        if (this.partially_decoded_line.length) {
            let last_line = this.partially_decoded_line;
            this.partially_decoded_line = '';
            this.process_line(last_line);
        } else {
            this.try_resolve_next_record();
        }
    };


    this.stop = function() {
        this.stream.destroy(); // TODO consider using pause() instead
    };


    this.start = function() {
        if (this.started)
            return;
        this.started = true;
        this.stream.on('data', (data_chunk) => { this.process_data_chunk(data_chunk); });
        this.stream.on('end', () => { this.process_data_end(); });
    };


    this.get_warnings = function() {
        let result = [];
        if (this.first_defective_line !== null)
            result.push(`Defective double quote escaping in ${this.table_name} table. E.g. at line ${this.first_defective_line}`);
        if (this.utf8_bom_removed)
            result.push(`UTF-8 Byte Order Mark (BOM) was found and skipped in ${this.table_name} table`);
        if (Object.keys(this.fields_info).length > 1)
            result.push(make_inconsistent_num_fields_warning('input', this.fields_info));
        return result;
    };
}


function CSVWriter(stream, close_stream_on_finish, encoding, delim, policy, line_separator='\n') {
    this.stream = stream;
    this.encoding = encoding;
    if (encoding)
        this.stream.setDefaultEncoding(encoding);
    this.delim = delim;
    this.policy = policy;
    this.line_separator = line_separator;
    this.sub_array_delim = delim == '|' ? ';' : '|';

    this.close_stream_on_finish = close_stream_on_finish;

    this.null_in_output = false;
    this.delim_in_simple_output = false;


    this.quoted_join = function(fields) {
        let delim = this.delim;
        var quoted_fields = fields.map(function(v) { return csv_utils.quote_field(String(v), delim); });
        return quoted_fields.join(this.delim);
    };


    this.quoted_join_rfc = function(fields) {
        let delim = this.delim;
        var quoted_fields = fields.map(function(v) { return csv_utils.rfc_quote_field(String(v), delim); });
        return quoted_fields.join(this.delim);
    };


    this.mono_join = function(fields) {
        if (fields.length > 1) {
            throw new RbqlIOHandlingError('Unable to use "Monocolumn" output format: some records have more than one field');
        }
        return fields[0];
    };


    this.simple_join = function(fields) {
        var res = fields.join(this.delim);
        if (fields.join('').indexOf(this.delim) != -1) {
            this.delim_in_simple_output = true;
        }
        return res;
    };


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


    this.normalize_fields = function(out_fields) {
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


    this.write = function(fields) {
        this.normalize_fields(fields);
        this.stream.write(this.polymorphic_join(fields));
        this.stream.write(this.line_separator);
    };


    this._write_all = function(table) {
        for (let i = 0; i < table.length; i++) {
            this.write(table[i]);
        }
    };


    this.finish = async function() {
        let close_stream_on_finish = this.close_stream_on_finish;
        let output_stream = this.stream;
        let output_encoding = this.encoding;
        let finish_promise = new Promise(function(resolve, reject) {
            if (close_stream_on_finish) {
                output_stream.end('', output_encoding, () => { resolve(); });
            } else {
                setTimeout(() => { resolve(); }, 0);
            }
        });
        return finish_promise;
    };


    this.get_warnings = function() {
        let result = [];
        if (this.null_in_output)
            result.push('None values in output were replaced by empty strings');
        if (this.delim_in_simple_output)
            result.push('Some output fields contain separator');
        return result;
    };

}


function FileSystemCSVRegistry(delim, policy, encoding) {
    this.delim = delim;
    this.policy = policy;
    this.encoding = encoding;
    this.stream = null;
    this.record_iterator = null;

    this.get_iterator_by_table_id = function(table_id) {
        let table_path = find_table_path(table_id);
        if (table_path === null) {
            throw new RbqlIOHandlingError(`Unable to find join table "${table_id}"`);
        }
        this.stream = fs.createReadStream(table_path);
        this.record_iterator = new CSVRecordIterator(this.stream, this.encoding, this.delim, this.policy, table_id, 'b');
        return this.record_iterator;
    };
}


async function csv_run(user_query, input_path, input_delim, input_policy, output_path, output_delim, output_policy, csv_encoding, user_init_code='') {
    let input_stream = input_path === null ? process.stdin : fs.createReadStream(input_path);
    let [output_stream, close_output_on_finish] = output_path === null ? [process.stdout, false] : [fs.createWriteStream(output_path), true];
    if (input_delim == '"' && input_policy == 'quoted')
        throw new RbqlIOHandlingError('Double quote delimiter is incompatible with "quoted" policy');
    if (csv_encoding == 'latin-1')
        csv_encoding = 'binary';
    if (!is_ascii(user_query) && csv_encoding == 'binary')
        throw new RbqlIOHandlingError('To use non-ascii characters in query enable UTF-8 encoding instead of latin-1/binary');
    if ((!is_ascii(input_delim) || !is_ascii(output_delim)) && csv_encoding == 'binary')
        throw new RbqlIOHandlingError('To use non-ascii characters in query enable UTF-8 encoding instead of latin-1/binary');

    let default_init_source_path = path.join(os.homedir(), '.rbql_init_source.js');
    if (user_init_code == '' && fs.existsSync(default_init_source_path)) {
        user_init_code = read_user_init_code(default_init_source_path);
    }

    let join_tables_registry = new FileSystemCSVRegistry(input_delim, input_policy, csv_encoding);
    let input_iterator = new CSVRecordIterator(input_stream, csv_encoding, input_delim, input_policy);
    let output_writer = new CSVWriter(output_stream, close_output_on_finish, csv_encoding, output_delim, output_policy);

    if (debug_mode)
        rbql.set_debug_mode();
    let warnings = await rbql.generic_run(user_query, input_iterator, output_writer, join_tables_registry, user_init_code);
    return warnings;
}


function set_debug_mode() {
    debug_mode = true;
}


module.exports.is_ascii = is_ascii;
module.exports.CSVRecordIterator = CSVRecordIterator;
module.exports.CSVWriter = CSVWriter;
module.exports.FileSystemCSVRegistry = FileSystemCSVRegistry;
module.exports.interpret_named_csv_format = interpret_named_csv_format;
module.exports.read_user_init_code = read_user_init_code;
module.exports.csv_run = csv_run;
module.exports.set_debug_mode = set_debug_mode;
module.exports.RecordQueue = RecordQueue;
module.exports.parse_dictionary_variables = parse_dictionary_variables;
module.exports.parse_attribute_variables = parse_attribute_variables;
