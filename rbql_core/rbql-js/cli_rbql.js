#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const rbql = require('./rbql.js');
const rbql_utils = require('./rbql_utils.js');


function die(error_msg) {
    console.error('Error: ' + error_msg);
    process.exit(1);
}


var tmp_worker_module_path = null;
var error_format = 'hr';
var interactive_mode = false;
var user_input_reader = null;


function show_error(msg) {
    if (interactive_mode) {
        console.log('\x1b[31;1mError:\x1b[0m ' + msg);
    } else {
        console.error('Error: ' + msg);
    }
    if (fs.existsSync(tmp_worker_module_path)) {
        let output_func = interactive_mode ? console.log : console.error;
        output_func('Generated module was saved here: ' + tmp_worker_module_path);
    }
}


function show_warning(msg) {
    if (interactive_mode) {
        console.log('\x1b[33;1mWarning:\x1b[0m ' + msg);
    } else {
        console.error('Warning: ' + msg);
    }
}


function show_help(scheme) {
    console.log('Options:\n');
    for (var k in scheme) {
        console.log(k);
        if (scheme[k].hasOwnProperty('default')) {
            console.log('    Default: "' + scheme[k]['default'] + '"');
        }
        console.log('    ' + scheme[k]['help']);
        console.log();
    }
}


function normalize_cli_key(cli_key) {
    return cli_key.replace(/^-*/, '');
}


function parse_cmd_args(cmd_args, scheme) {
    var result = {};
    for (var arg_key in scheme) {
        var arg_info = scheme[arg_key];
        if (arg_info.hasOwnProperty('default'))
            result[normalize_cli_key(arg_key)] = arg_info['default'];
    }
    cmd_args = cmd_args.slice(2);
    var i = 0;
    while(i < cmd_args.length) {
        var arg_key = cmd_args[i];
        if (arg_key == '--help') {
            show_help(scheme);
            process.exit(0);
        }
        i += 1;
        if (!scheme.hasOwnProperty(arg_key)) {
            die(`unknown argument: ${arg_key}`);
        }
        var arg_info = scheme[arg_key];
        var normalized_key = normalize_cli_key(arg_key);
        if (arg_info['boolean']) {
            result[normalized_key] = true;
            continue;    
        }
        if (i >= cmd_args.length) {
            die(`no CLI value for key: ${arg_key}`);
        }
        var arg_value = cmd_args[i];
        i += 1;
        result[normalized_key] = arg_value;
    }
    return result;
}


function normalize_delim(delim) {
    if (delim == 'TAB')
        return '\t';
    if (delim == '\\t')
        return '\t';
    return delim;
}


function interpret_format(format_name, input_delim, input_policy) {
    rbql.assert(['csv', 'tsv', 'monocolumn', 'input'].indexOf(format_name) != -1, 'unknown format');
    if (format_name == 'input')
        return [input_delim, input_policy];
    if (format_name == 'monocolumn')
        return ['', 'monocolumn'];
    if (format_name == 'csv')
        return [',', 'quoted'];
    return ['\t', 'simple'];
}


function get_default(src, key, default_val) {
    return src.hasOwnProperty(key) ? src[key] : default_val;
}


function cleanup_tmp() {
    if (fs.existsSync(tmp_worker_module_path)) {
        fs.unlinkSync(tmp_worker_module_path);
    }
}


function report_warnings_hr(warnings) {
    if (warnings !== null) {
        let hr_warnings = rbql.make_warnings_human_readable(warnings);
        for (let i = 0; i < hr_warnings.length; i++) {
            show_warning(hr_warnings[i]);
        }
    }
}


function show_query_prompt() {
    console.log('\nInput SQL-like RBQL query and press Enter:');
    process.stdout.write('> ');
}


function report_warnings_json(warnings) {
    if (warnings !== null) {
        var warnings_report = JSON.stringify({'warnings': warnings});
        process.stderr.write(warnings_report);
    }
}


function report_error_json(error_msg) {
    let report = new Object();
    report.error = error_msg
    process.stderr.write(JSON.stringify(report));
    if (fs.existsSync(tmp_worker_module_path)) {
        console.log('\nGenerated module was saved here: ' + tmp_worker_module_path);
    }
}


function finish_query_with_error(error_msg) {
    if (error_format == 'hr') {
        show_error(error_msg);
    } else {
        report_error_json(error_msg);
    }
    if (!interactive_mode) {
        process.exit(1);
    } else {
        show_query_prompt();
    }
}


function get_error_message(error) {
    if (error && error.message)
        return error.message;
    return String(error);
}


function get_default_policy(delim) {
    if ([';', ','].indexOf(delim) != -1) {
        return 'quoted';
    } else if (delim == ' ') {
        return 'whitespace';
    } else {
        return 'simple';
    }
}


function is_delimited_table(sampled_lines, delim, policy) {
    if (sampled_lines.length < 10)
        return false;
    let num_fields = null;
    for (var i = 0; i < sampled_lines.length; i++) {
        let [fields, warning] = rbql_utils.smart_split(sampled_lines[i], delim, policy, true);
        if (warning)
            return false;
        if (num_fields === null)
            num_fields = fields.length;
        if (num_fields != fields.length)
            return false;
    }
    return true;
}


function sample_lines(table_path, callback_func) {
    let input_reader = readline.createInterface({ input: fs.createReadStream(table_path) });
    let sampled_lines = [];
    input_reader.on('line', line => {
        sampled_lines.push(line);
        if (sampled_lines.length >= 10)
            input_reader.close();
    });
    input_reader.on('close', () => { callback_func(sampled_lines); });
}


function sample_records(table_path, delim, policy, callback_func) {
    sample_lines(table_path, (sampled_lines) => {
        let records = [];
        let bad_lines = [];
        for (var i = 0; i < sampled_lines.length; i++) {
            let [fields, warning] = rbql_utils.smart_split(sampled_lines[i], delim, policy, true);
            if (warning)
                bad_lines.push(i + 1);
            records.push(fields);
        }
        callback_func(records, bad_lines);
    });
}


function autodetect_delim_policy(table_path, sampled_lines) {
    let autodetection_dialects = [['\t', 'simple'], [',', 'quoted'], [';', 'quoted']];
    for (var i = 0; i < autodetection_dialects.length; i++) {
        let [delim, policy] = autodetection_dialects[i];
        if (is_delimited_table(sampled_lines, delim, policy))
            return [delim, policy];
    }
    if (table_path.endsWith('.csv'))
        return [',', 'quoted'];
    if (table_path.endsWith('.tsv'))
        return ['\t', 'simple'];
    return [null, null];
}


function print_colorized(records, delim, show_column_names) {
    let reset_color_code = '\x1b[0m';
    let color_codes = ['\x1b[0m', '\x1b[31m', '\x1b[32m', '\x1b[33m', '\x1b[34m', '\x1b[35m', '\x1b[36m', '\x1b[31;1m', '\x1b[32;1m', '\x1b[33;1m'];
    for (let r = 0; r < records.length; r++) {
        let out_fields = [];
        for (let c = 0; c < records[r].length; c++) {
            let color_code = color_codes[c % color_codes.length];
            let field = records[r][c];
            let colored_field = show_column_names ? `${color_code}a${c + 1}:${field}` : color_code + field;
            out_fields.push(colored_field);
        }
        let out_line = out_fields.join(delim) + reset_color_code;
        console.log(out_line);
    }
}


function handle_worker_success(warnings, output_path, delim, policy) {
    cleanup_tmp();
    if (error_format == 'hr') {
        report_warnings_hr(warnings);
        if (interactive_mode) {
            user_input_reader.close();
            sample_records(output_path, delim, policy, (records, bad_lines) => {
                console.log('\nOutput table preview:');
                console.log('====================================');
                print_colorized(records, delim, false);
                console.log('====================================');
                console.log('Success! Result table was saved to: ' + output_path);
            });
        }
    } else {
        report_warnings_json(warnings);
    }
}


function run_with_js(args) {
    var delim = normalize_delim(args['delim']);
    var policy = args['policy'] ? args['policy'] : get_default_policy(delim);
    var query = args['query'];
    if (!query) {
        finish_query_with_error('Parsing Error: RBQL query is empty');
        return;
    }
    var input_path = get_default(args, 'input', null);
    var output_path = get_default(args, 'output', null);
    var csv_encoding = args['encoding'];
    var output_delim = get_default(args, 'out-delim', null);
    var output_policy = get_default(args, 'out-policy', null);
    let init_source_file = get_default(args, 'init-source-file', null);
    if (output_delim === null) {
        [output_delim, output_policy] = interpret_format(args['out-format'], delim, policy);
    }
    var rbql_lines = [query];
    var tmp_dir = os.tmpdir();
    var script_filename = 'rbconvert_' + String(Math.random()).replace('.', '_') + '.js';
    tmp_worker_module_path = path.join(tmp_dir, script_filename);
    try {
        rbql.parse_to_js(input_path, output_path, rbql_lines, tmp_worker_module_path, delim, policy, output_delim, output_policy, csv_encoding, init_source_file);
    } catch (e) {
        finish_query_with_error('Parsing Error: ' + get_error_message(e));
        return;
    }
    if (args.hasOwnProperty('parse-only')) {
        console.log('Worker module location: ' + tmp_worker_module_path);
        return;
    }
    var worker_module = require(tmp_worker_module_path);
    worker_module.run_on_node((warnings) => { handle_worker_success(warnings, output_path, delim, policy); }, finish_query_with_error);
}


function get_default_output_path(input_path, delim) {
    let well_known_extensions = {',': '.csv', '\t': '.tsv'};
    if (well_known_extensions.hasOwnProperty(delim))
        return input_path + well_known_extensions[delim];
    return input_path + '.txt';
}


function run_interactive_loop(args) {
    show_query_prompt();
    user_input_reader = readline.createInterface({ input: process.stdin });
    user_input_reader.on('line', line => {
        args.query = line.trim();
        run_with_js(args);
    });
}


function show_preview(args, input_path, delim, policy) {
    if (!delim) {
        die('Unable to autodetect table delimiter. Provide column separator explicitly with "--delim" option');
    }
    args.delim = delim;
    args.policy = policy;
    sample_records(input_path, delim, policy, (records, bad_lines) => {
        console.log('Input table preview:')
        console.log('====================================')
        print_colorized(records, delim, true)
        console.log('====================================\n')
        if (bad_lines.length)
            show_warning('Some input lines have quoting errors. Line numbers: ' + bad_lines.join(','));
        if (!args.output) {
            args.output = get_default_output_path(input_path, delim);
            show_warning('Output path was not provided. Result set will be saved as: ' + args.output);
        }
        run_interactive_loop(args);
    });
}


function start_preview_mode(args) {
    let input_path = get_default(args, 'input', null);
    if (!input_path) {
        show_error('Input file must be provided in interactive mode. You can use stdin input only in non-interactive mode');
        process.exit(1);
    }
    if (error_format != 'hr') {
        show_error('Only default "hr" error format is supported in interactive mode');
        process.exit(1);
    }
    let delim = get_default(args, 'delim', null);
    let policy = null;
    if (delim !== null) {
        delim = normalize_delim(delim);
        policy = args['policy'] ? args['policy'] : get_default_policy(delim);
        show_preview(args, input_path, delim, policy);
    } else {
        sample_lines(input_path, (sampled_lines) => { 
            let [delim, policy] = autodetect_delim_policy(input_path, sampled_lines); 
            show_preview(args, input_path, delim, policy);
        });
    }
}


function main() {
    var scheme = {
        '--query': {'help': 'Query string in rbql'},
        '--input': {'help': 'Read csv table from FILE instead of stdin'},
        '--output': {'help': 'Write output table to FILE instead of stdout'},
        '--delim': {'default': 'TAB', 'help': 'Delimiter'},
        '--policy': {'help': 'Split policy'},
        '--out-format': {'default': 'input', 'help': 'Output format'},
        '--error-format': {'default': 'hr', 'help': 'Error and warnings format. [hr|json]'},
        '--out-delim': {'help': 'Output delim. Use with "out-policy". Overrides out-format'},
        '--out-policy': {'help': 'Output policy. Use with "out-delim". Overrides out-format'},
        '--encoding': {'default': rbql.default_csv_encoding, 'help': 'Manually set csv table encoding'},
        '--parse-only': {'boolean': true, 'help': 'Create worker module and exit'},
        '--version': {'boolean': true, 'help': 'Script language to use in query'},
        '--init-source-file': {'help': 'Path to init source file to use instead of ~/.rbql_init_source.js'}
    };
    var args = parse_cmd_args(process.argv, scheme);

    if (args.hasOwnProperty('version')) {
        console.log(rbql.version);
        process.exit(0);
    }
    if (args.encoding == 'latin-1')
        args.encoding = 'binary';

    error_format = args['error-format'];

    if (args.hasOwnProperty('query')) {
        interactive_mode = false;
        run_with_js(args);
    } else {
        interactive_mode = true;
        start_preview_mode(args);
    }
}

module.exports.parse_cmd_args = parse_cmd_args;

if (require.main === module) {
    main();
}


