// This file stores only functionality that is required for idle operation of Rainbow CSV i.e. autodetection only.
// We want to avoid loading/parsing a lot of JS code in cases where we don't have any CSV files to work with.

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

class RecordTextConsumer {
    // Need this class to avoid code duplication when dealing with leftover lines in rfc_line_buffer.
    constructor(delim, policy, stop_on_warning, collect_records, detect_trailing_spaces, min_num_fields_for_autodetection) {
        this.delim = delim;
        this.policy = policy;
        this.stop_on_warning = stop_on_warning;
        this.first_defective_line = null;
        this.records = collect_records ? [] : null;
        this.collect_records = collect_records;
        this.num_records_parsed = 0;
        this.fields_info = new Object();
        this.first_trailing_space_line = null;
        this.detect_trailing_spaces = detect_trailing_spaces;
        this.preserve_quotes_and_whitespaces = !collect_records;
        this.min_num_fields_for_autodetection = min_num_fields_for_autodetection;
    }

    consume(record_text, record_start_line) {
        let [record, warning] = csv_utils.smart_split(record_text, this.delim, this.policy, this.preserve_quotes_and_whitespaces);
        if (warning) {
            if (this.first_defective_line === null) {
                this.first_defective_line = record_start_line;
            }
        }
        if (this.detect_trailing_spaces && this.first_trailing_space_line === null) {
            for (let field of record) {
                if (field.length && (field.charAt(0) == ' ' || field.charAt(field.length - 1) == ' ')) {
                    this.first_trailing_space_line = record_start_line;
                }
            }
        }
        let need_stop = false;
        if (!this.fields_info.hasOwnProperty(record.length)) {
            this.fields_info[record.length] = this.num_records_parsed;
            if (this.min_num_fields_for_autodetection != -1) {
                // FIXME test this!
                // Autodetection mode: stop on inconsistent records length and when there is not enough columns (typically less than 2 i.e. 1).
                need_stop = need_stop || record.length < this.min_num_fields_for_autodetection; // Too few columns.
                need_stop = need_stop || Object.keys(this.fields_info).length > 1; // Inconsistent number of columns in different rows.
            }
        }
        if (this.collect_records) {
            this.records.push(record);
        }
        this.num_records_parsed += 1;
        // FIXME test warning early stopping both for rfc and basic quoted policies.
        need_stop = need_stop || (warning && this.stop_on_warning);
        return !need_stop;
    }
}


function parse_document_records(document, delim, policy, comment_prefix=null, stop_on_warning=false, max_records_to_parse=-1, collect_records=true, detect_trailing_spaces=false, min_num_fields_for_autodetection=-1) {
    // FIXME this needs to be in extension.js because it is needed for autodetection. Pass this function to the iterator, or parse records externally.
    // Returns list of records.
    // FIXME write a unit test by creating a document-like wrapper around a JS array which would support lineCount and lineAt functions.
    // TODO consider to map records to line numbers and return the mapping too.
    // One line never maps to more than one record. One record can map to multiple lines i.e. multiple lines can map to one records.
    let num_lines = document.lineCount;
    let rfc_line_buffer = [];
    let record_start_line = 0;

    let consumer = new RecordTextConsumer(delim, policy, stop_on_warning, collect_records, detect_trailing_spaces, min_num_fields_for_autodetection);

    for (let lnum = 0; lnum < num_lines; ++lnum) {
        let line_text = document.lineAt(lnum).text;
        if (lnum + 1 >= num_lines && line_text == "") {
            break; // Skip the last empty line.
        }
        let record_text = null;
        if (policy == 'quoted_rfc') {
            record_text = csv_utils.accumulate_rfc_line_into_record(rfc_line_buffer, line_text, comment_prefix);
        } else if (comment_prefix === null || !line_text.startsWith(comment_prefix)) {
            record_text = line_text;
        }
        if (record_text === null) {
            continue;
        }
        if (!consumer.consume(record_text, record_start_line)) {
            return [consumer.records, consumer.fields_info, consumer.first_defective_line, consumer.first_trailing_space_line];
        }

        record_start_line = lnum + 1;
        if (max_records_to_parse !== -1 && consumer.num_records_parsed >= max_records_to_parse) {
            return [consumer.records, consumer.fields_info, consumer.first_defective_line, consumer.first_trailing_space_line];
        }
    }
    if (rfc_line_buffer.length > 0) {
        assert(policy == 'quoted_rfc');
        let record_text = rfc_line_buffer.join('\n');
        if (!consumer.consume(record_text, record_start_line)) {
            return [consumer.records, consumer.fields_info, consumer.first_defective_line, consumer.first_trailing_space_line];
        }
    }
    return [consumer.records, consumer.fields_info, consumer.first_defective_line, consumer.first_trailing_space_line];
}


module.exports.parse_document_records = parse_document_records;
module.exports.assert = assert;
