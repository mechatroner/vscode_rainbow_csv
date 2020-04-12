const os = require('os');
const fs = require('fs');
const path = require('path');

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
    let sampled_lines = [];
    let closed = false;
    input_reader.on('line', line => {
        if (!closed) {
            closed = true;
            input_reader.close();
            process_header_line_callback(line)
        }
    });
}


module.exports.write_table_name = write_table_name;
module.exports.read_table_path = read_table_path;
module.exports.read_header = read_header;
