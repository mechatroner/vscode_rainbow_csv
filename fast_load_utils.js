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
    // The only purpose of this class is to avoid code duplication when dealing with leftover lines in line_aggregator (the second `consume` call).
    constructor(delim, policy, stop_on_warning, collect_records, preserve_quotes_and_whitespaces, detect_trailing_spaces, min_num_fields_for_autodetection) {
        this.delim = delim;
        this.policy = policy;
        this.stop_on_warning = stop_on_warning;
        this.first_defective_line = null;
        this.records = collect_records ? [] : null;
        this.collect_records = collect_records;
        this.num_records_parsed = 0;
        this.fields_info = new Map();
        this.first_trailing_space_line = null;
        this.detect_trailing_spaces = detect_trailing_spaces;
        this.preserve_quotes_and_whitespaces = preserve_quotes_and_whitespaces;
        this.min_num_fields_for_autodetection = min_num_fields_for_autodetection;
    }

    consume(record_text, record_start_line) {
        let [record, warning] = csv_utils.smart_split(record_text, this.delim, this.policy, this.preserve_quotes_and_whitespaces);
        if (warning) {
            if (this.first_defective_line === null) {
                this.first_defective_line = record_start_line;
            }
            if (this.stop_on_warning)
                return /*can_continue=*/false;
        }
        if (this.detect_trailing_spaces && this.first_trailing_space_line === null) {
            for (let field of record) {
                if (field.length && (field.charAt(0) == ' ' || field.charAt(field.length - 1) == ' ')) {
                    this.first_trailing_space_line = record_start_line;
                }
            }
        }
        if (!this.fields_info.has(record.length)) {
            this.fields_info.set(record.length, this.num_records_parsed);
            if (this.min_num_fields_for_autodetection != -1) {
                // Autodetection mode: stop on inconsistent records length and when there is not enough columns (typically less than 2 i.e. 1).
                if (record.length < this.min_num_fields_for_autodetection)
                    return /*can_continue=*/false;
                if (this.fields_info.size > 1)
                    return /*can_continue=*/false;
            }
        }
        if (this.collect_records) {
            this.records.push(record);
        }
        this.num_records_parsed += 1;
        return /*can_continue=*/true;
    }
}


function parse_document_records(document, delim, policy, comment_prefix=null, stop_on_warning=false, max_records_to_parse=-1, collect_records=true, preserve_quotes_and_whitespaces=false, detect_trailing_spaces=false, min_num_fields_for_autodetection=-1) {
    let num_lines = document.lineCount;
    let record_start_line = 0;
    let line_aggregator = new csv_utils.MultilineRecordAggregator(comment_prefix);
    let consumer = new RecordTextConsumer(delim, policy, stop_on_warning, collect_records, preserve_quotes_and_whitespaces, detect_trailing_spaces, min_num_fields_for_autodetection);
    let comments = []; // An ordered list of {record_no, comment_text} tuples which can be merged with the records later.

    for (let lnum = 0; lnum < num_lines; ++lnum) {
        let line_text = document.lineAt(lnum).text;
        if (lnum + 1 >= num_lines && line_text == "") {
            if (collect_records) {
                // Treat the last empty line as a comment - this is to prevent align/shrink functions from removing it.
                comments.push({record_num: consumer.num_records_parsed, comment_text: line_text});
            }
            break; // Skip the last empty line.
        }
        let record_text = null;
        if (policy == 'quoted_rfc') {
            line_aggregator.add_line(line_text);
            if (line_aggregator.has_comment_line) {
                record_start_line = lnum + 1;
                line_aggregator.reset();
                if (collect_records) {
                    comments.push({record_num: consumer.num_records_parsed, comment_text: line_text});
                }
                continue;
            } else if (line_aggregator.has_full_record) {
                record_text = line_aggregator.get_full_line('\n');
                line_aggregator.reset();
            } else {
                continue;
            }
        } else {
            if (comment_prefix && line_text.startsWith(comment_prefix)) {
                record_start_line = lnum + 1;
                if (collect_records) {
                    comments.push({record_num: consumer.num_records_parsed, comment_text: line_text});
                }
                continue;
            } else {
                record_text = line_text;
            }
        }
        if (!consumer.consume(record_text, record_start_line)) {
            return [consumer.records, consumer.num_records_parsed, consumer.fields_info, consumer.first_defective_line, consumer.first_trailing_space_line, comments];
        }
        record_start_line = lnum + 1;
        if (max_records_to_parse !== -1 && consumer.num_records_parsed >= max_records_to_parse) {
            return [consumer.records, consumer.num_records_parsed, consumer.fields_info, consumer.first_defective_line, consumer.first_trailing_space_line, comments];
        }
    }

    if (line_aggregator.is_inside_multiline_record()) {
        assert(policy == 'quoted_rfc');
        consumer.consume(line_aggregator.get_full_line('\n'), record_start_line);
    }
    return [consumer.records, consumer.num_records_parsed, consumer.fields_info, consumer.first_defective_line, consumer.first_trailing_space_line, comments];
}


module.exports.parse_document_records = parse_document_records;
module.exports.assert = assert;
