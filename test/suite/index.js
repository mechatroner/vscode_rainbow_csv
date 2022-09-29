const assert = require('assert');
const os = require('os');

const vscode = require('vscode');

const rainbow_utils = require('../../rainbow_utils.js');
const unit_tests = require('./unit_tests.js');


// The only reason why we are importing extension as a module here is to run some small unit tests like autodetect_dialect_frequency_based. 
// All other functionality such as commands and highlighting would work without this import/require line, since the extension is activated using VSCode internal mechanisms.
// So the require/import extension line below can be deleted and all of the main integration tests would still pass.
const extension = require('../../extension.js');


const is_web_ext = (os.homedir === undefined); // Runs as web extension in browser.

// TODO make RBQL command wait for the result to reduce the timeout.
const poor_rbql_async_design_workaround_timeout = 6000;


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function log_message(msg) {
    console.log('###RAINBOW_CSV_UNIT_TEST_MESSAGE### ' + msg);
}


async function test_comment_prefix_js(workspace_folder_uri) {
    let [uri, active_doc, editor, lint_report] = [null, null, null, null];
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'countries_with_comments.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    lint_report = await vscode.commands.executeCommand('rainbow-csv.CSVLint');
    assert(!lint_report.is_ok); // Lint is failing because we mistakenly treat comment lines as records.

    await vscode.commands.executeCommand("cursorRightSelect");
    await vscode.commands.executeCommand("cursorRightSelect");
    await sleep(1000);
    await vscode.commands.executeCommand('rainbow-csv.SetCommentPrefix');
    await sleep(1500);

    lint_report = await vscode.commands.executeCommand('rainbow-csv.CSVLint');
    assert(lint_report.is_ok); // Lint is OK because we marked comment lines as comments.
    await sleep(1000);

    // Now lets toggle the comment.
    await vscode.commands.executeCommand("cursorTop");
    await vscode.commands.executeCommand("cursorRight");
    await vscode.commands.executeCommand("cursorRight");
    await sleep(500);
    await vscode.commands.executeCommand("editor.action.commentLine");
    lint_report = await vscode.commands.executeCommand('rainbow-csv.CSVLint');
    assert(!lint_report.is_ok); // Lint is failing again because we toggled the first comment line.
    await sleep(1000);
    await vscode.commands.executeCommand("editor.action.commentLine");
    lint_report = await vscode.commands.executeCommand('rainbow-csv.CSVLint');
    assert(lint_report.is_ok); // Lint is OK now because we toggled the first line again back to its comment state.
    await sleep(1000);
    // Undo twice to avoid unsaved changes for RBQL.
    await vscode.commands.executeCommand("undo");
    await vscode.commands.executeCommand("undo");
    await sleep(1000);

    test_task = {rbql_backend: "js", rbql_query: "SELECT a.Country, a.Population", with_headers: true, integration_test_delay: 1500};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    num_lines_after_query = active_doc.lineCount;
    log_message(`Length after js query: ${num_lines_after_query}`);
    let expected_num_lines = 11; // 10 records + header.
    if (!is_web_ext) {
        expected_num_lines += 1; // Standard non-web CSV writer adds a newline at the end.
    }
    assert.equal(expected_num_lines, num_lines_after_query);
}

async function test_comment_prefix_python_rbql(workspace_folder_uri) {
    let [uri, active_doc, editor, lint_report] = [null, null, null, null];
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'countries_with_comments.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    // Don't need to select comment prefix again since we already did it for this file in the previous test.
    // Using Python native expressions to make sure that we are running python query.
    test_task = {rbql_backend: "python", rbql_query: "SELECT '[{}]'.format(a.Country), int(a.Population) / 10", with_headers: true, integration_test_delay: 1500};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    num_lines_after_query = active_doc.lineCount;
    log_message(`Length after python query: ${num_lines_after_query}`);
    assert.equal(12, num_lines_after_query); // Ten records + header + trailing empty line = 12
}


async function test_rbql_node(workspace_folder_uri) {
    let [uri, active_doc, editor] = [null, null, null];

    // Test comment prefix and js query with it.
    await test_comment_prefix_js(workspace_folder_uri);
    // Test comment prefix with python query.
    await test_comment_prefix_python_rbql(workspace_folder_uri);

    // Test Python query.
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'university_ranking.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    let test_task = {rbql_backend: "python", with_headers: true, rbql_query: "select top 20 a1, math.ceil(float(a.total_score) * 100), a['university_name'], None, 'foo bar' order by a2"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    // Indirectly check reported warnings.
    let state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_last_rbql_warnings: true});
    assert.equal('["None values in output were replaced by empty strings"]', JSON.stringify(state_report.warnings));
    active_doc = vscode.window.activeTextEditor.document;
    let length_after_query = active_doc.getText().length;
    log_message(`Length after python query: ${length_after_query}`);
    assert.equal(868, length_after_query); // wc -c gives smaller value. Probably VSCode uses '\r\n' as line ends.

    // Test JS query.
    test_task = {rbql_backend: "js", rbql_query: "select a2 * 10, a3, a3.length where NR > 1 order by a3.length limit 10"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Length after js query: ${length_after_query}`);
    assert.equal(268, length_after_query);

    // Test RBQL query error reporting.
    test_task = {rbql_backend: "python", rbql_query: "select nonexistent_function(a1)"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_last_rbql_report: true});
    assert.equal('query execution', state_report.error_type);
    assert.equal("At record 1, Details: name 'nonexistent_function' is not defined", state_report.error_msg);

    // Test with multiline records.
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'synthetic_rfc_newline_data.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    assert.equal(active_doc.languageId, 'dynamic csv');
    test_task = {rbql_backend: "js", rbql_query: "select '<<<<<', a3, a2, a1, '>>>>> NR: ' + NR"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Length after js multiline-record query: ${length_after_query}`);
    assert.equal(645, length_after_query);

    // Test RBQL JOIN query.
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'university_ranking.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    test_task = {rbql_backend: "python", with_headers: true, rbql_query: "select a.university_name, b.Country, b.Population, b['GDP per capita'] JOIN countries.csv on a.country == b.Country order by int(b.Population) desc"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_last_rbql_warnings: true});
    assert.equal('["The first record in JOIN file countries.csv was also treated as header (and skipped)"]', JSON.stringify(state_report.warnings));
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Length after join query: ${length_after_query}`);
    // Not sure why it is 11592 and not 11610, when saving the file `wc -c` gives 11610.
    assert.equal(11592, length_after_query);
    // We have 202 not 201 because the trailing '\n' maps to a trailing empty line in VSCode.
    assert.equal(202, active_doc.lineCount);

    // Test UPDATE, no warnings and copy back.
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'countries.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    let filename_before = active_doc.fileName;
    let length_before_query = active_doc.getText().length;
    editor = await vscode.window.showTextDocument(active_doc);
    assert(active_doc.getText().indexOf('oceania') == -1);
    assert(active_doc.getText().indexOf('OCEANIA') > 0);
    await sleep(1000);

    test_task = {rbql_backend: "python", with_headers: true, rbql_query: "UPDATE set a.Region = a.Region.lower()"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_last_rbql_warnings: true});
    assert.equal('[]', JSON.stringify(state_report.warnings));
    active_doc = vscode.window.activeTextEditor.document;
    let filename_after = active_doc.fileName;
    length_after_query = active_doc.getText().length;
    log_message(`Length after update query: ${length_after_query}`);
    // Changing column to lowercase should not affect the doc length if we account for the '\r\n' line endings.
    assert.equal(length_before_query, length_after_query - active_doc.lineCount + 1);
    assert(active_doc.getText().indexOf('OCEANIA') == -1);
    assert(active_doc.getText().indexOf('oceania') > 0);

    await sleep(1000);
    await vscode.commands.executeCommand('rainbow-csv.CopyBack');
    await sleep(1000);
    active_doc = await vscode.workspace.openTextDocument(uri);
    let filename_after_copy_back = active_doc.fileName;
    // Make sure that the name stays the same as the original doc but the content has changed.
    assert.equal(filename_before, filename_after_copy_back);
    assert(active_doc.getText().indexOf('OCEANIA') == -1);
    assert(active_doc.getText().indexOf('oceania') > 0);
}


async function test_rbql_web(workspace_folder_uri) {
    let [uri, active_doc, editor] = [null, null, null];

    // Test comment prefix and js query with it.
    await test_comment_prefix_js(workspace_folder_uri);

    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'university_ranking.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    let test_task = {rbql_backend: "js", with_headers: true, rbql_query: "select top 20 a1, Math.ceil(parseFloat(a.total_score) * 100), a['university_name'], null, 'foo bar' order by a2"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);

    // Indirectly check reported warnings.
    let state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_last_rbql_warnings: true});
    assert.equal('["null values in output were replaced by empty strings"]', JSON.stringify(state_report.warnings));
    active_doc = vscode.window.activeTextEditor.document;
    let length_after_query = active_doc.getText().length;
    log_message(`Length after first js query: ${length_after_query}`);
    assert.equal(846, length_after_query);

    test_task = {rbql_backend: "js", rbql_query: "select a2 * 10, a3, a3.length where NR > 1 order by a3.length limit 10"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Length after second js query: ${length_after_query}`);
    // 267 instead of 268 because no trailing '\n' at the end of file.
    assert.equal(267, length_after_query);

    // Test RBQL query error reporting.
    test_task = {rbql_backend: "js", rbql_query: "select nonexistent_function(a1)"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_last_rbql_report: true});
    assert.equal('query execution', state_report.error_type);
    assert.equal("At record 1, Details: nonexistent_function is not defined", state_report.error_msg);

    // Test with multiline records.
    log_message('Starting multiline records test');
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'synthetic_rfc_newline_data.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    test_task = {rbql_backend: "js", rbql_query: "select '<<<<<', a3, a2, a1, '>>>>> NR: ' + NR", enable_rfc_newlines: true};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Length after js multiline-record query: ${length_after_query}`);
    // 644 instead of 645 because no trailing '\n' at the end of file.
    assert.equal(644, length_after_query);
}


async function test_align_shrink_lint(workspace_folder_uri) {
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'university_ranking.csv');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    let length_original = active_doc.getText().length;
    log_message(`Original length: ${length_original}`)
    assert.equal(12538, length_original);
    await sleep(2000);

    await vscode.commands.executeCommand('rainbow-csv.Align');
    let length_aligned = active_doc.getText().length;
    log_message(`Aligned length: ${length_aligned}`)
    assert.equal(25896, length_aligned);
    assert(length_aligned > length_original);
    let lint_report = await vscode.commands.executeCommand('rainbow-csv.CSVLint');
    assert(lint_report.is_ok);
    await sleep(2000);

    await vscode.commands.executeCommand('rainbow-csv.Shrink');
    let length_shrinked = active_doc.getText().length;
    log_message(`Shrinked length: ${length_shrinked}`)
    // This is to ensure that after original -> align -> shrink sequence we get back to original doc.
    assert.equal(length_original, length_shrinked);
    await sleep(500);

    let text_with_comma = 'foobar,';
    await vscode.commands.executeCommand('default:type', { text: text_with_comma });
    lint_report = await vscode.commands.executeCommand('rainbow-csv.CSVLint');
    assert(lint_report.fields_info.size > 1);
    await sleep(500);

    for (let i = 0; i < text_with_comma.length; i++) {
        await vscode.commands.executeCommand("deleteLeft");
    }
    await sleep(500);
}


async function test_column_edit(workspace_folder_uri) {
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'movies.txt');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    let length_original = active_doc.getText().length;
    assert.equal(9986, length_original);
    for (let i = 0; i < 10; i++) {
        await vscode.commands.executeCommand("cursorRight");
    }
    await sleep(1000);
    await vscode.commands.executeCommand("rainbow-csv.ColumnEditAfter");
    await sleep(1000);
    let text_with_comma = 'foobar,';
    await vscode.commands.executeCommand('default:type', { text: text_with_comma });
    let length_after_column_edit = active_doc.getText().length;
    assert.equal(length_original + active_doc.lineCount * text_with_comma.length, length_after_column_edit);
    await sleep(1000);
    for (let i = 0; i < text_with_comma.length; i++) {
        await vscode.commands.executeCommand("deleteLeft");
    }
    await sleep(1000);
    let length_after_delete = active_doc.getText().length;
    // Ensure that after multicursor deletion of the added `text_with_comma` text we get back to the original doc.
    assert.equal(length_original, length_after_delete);
}


async function test_no_autodetection(workspace_folder_uri) {
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'lorem_ipsum.txt');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for lorem_ipsum.txt: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    let editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'suite', 'index.js');
    active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for index.js: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'javascript');
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'lorem_ipsum');
    active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for lorem_ipsum: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
}


async function test_dynamic_csv(workspace_folder_uri) {
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'movies_multichar_separator.txt');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for movies_multichar_separator.txt: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    let editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    for (let i = 0; i < 6; i++) {
        await vscode.commands.executeCommand("cursorRight");
    }
    for (let i = 0; i < 3; i++) {
        await vscode.commands.executeCommand("cursorRightSelect");
    }
    await sleep(1000);
    await vscode.commands.executeCommand('rainbow-csv.RainbowSeparator');
    await sleep(2000);
    log_message(`languageId for small_movies.pipe after RainbowSeparator: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'dynamic csv');
    await vscode.commands.executeCommand('rainbow-csv.RainbowSeparatorOff');
    await sleep(2000);
    log_message(`languageId for small_movies.pipe after RainbowSeparatorOff: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    await sleep(1000);

    await vscode.commands.executeCommand('rainbow-csv.RainbowSeparator');
    await sleep(1000);

    // Scroll around to test.
    await vscode.commands.executeCommand("scrollPageDown");
    await sleep(500);
    await vscode.commands.executeCommand("scrollPageUp");
    await sleep(500);

    let length_original = active_doc.getText().length;
    await vscode.commands.executeCommand('rainbow-csv.Align');
    let length_aligned = active_doc.getText().length;
    assert.equal(length_original + 8513, length_aligned); // 8513 was calculated as the difference in file sizes reported by wc -c.
    await sleep(1000);
    await vscode.commands.executeCommand('rainbow-csv.Shrink');
    await sleep(1000);
    let length_shrinked = active_doc.getText().length;
    assert.equal(length_original, length_shrinked);

    // Now we need to undo the commands to run RBQL.
    await vscode.commands.executeCommand('undo'); // Undo Shrink.
    await sleep(500);
    await vscode.commands.executeCommand('undo'); // Undo Align.
    await sleep(500);

    test_task = {rbql_backend: "js", rbql_query: "select a1, a4 % 100, a5 order by a1 limit 20"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Length after js query: ${length_after_query}`);
    await sleep(1000);
    let expected_num_lines = 742;
    if (!is_web_ext) {
        expected_num_lines += 1; // Standard non-web CSV writer adds a newline at the end.
    }
    assert.equal(expected_num_lines, length_after_query);
}

async function test_huge_file(workspace_folder_uri) {
    // Test huge file close to VSCode syntax highlighting limit (20MB Or 300K lines).
    // Do some basic navigation commands and some basic editing to ensure that performance is OK.
    let start_time = performance.now();
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'books_huge.txt');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    assert.equal(active_doc.languageId, 'csv');
    await vscode.commands.executeCommand("cursorBottom");
    await sleep(500);
    await vscode.commands.executeCommand("cursorTop");
    await sleep(500);
    for (let i = 0; i < 100; i++) {
        await vscode.commands.executeCommand("scrollPageDown");
        await sleep(10);
    }
    for (let i = 0; i < 10; i++) {
        // Delete some lines.
        await vscode.commands.executeCommand("editor.action.deleteLines");
        await sleep(10);
    }
    await sleep(500);
    await vscode.commands.executeCommand("cursorTop");
    await sleep(500);
    let end_time = performance.now();
    let total_sleep_time = 500 * 4 - 10 * 100 - 10 * 10;
    let total_adjusted_latency = (end_time - start_time) - total_sleep_time;
    log_message(`total adjusted latency: ${total_adjusted_latency}`)
    assert(total_adjusted_latency < 20000);
}

async function test_autodetection(workspace_folder_uri) {
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'university_ranking_semicolon.txt');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    log_message(`languageId for university_ranking_semicolon.txt: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'csv (semicolon)');
    await sleep(1000);
}


async function test_manual_enable_disable(workspace_folder_uri) {
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'small_movies.pipe');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for small_movies.pipe: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    let editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    for (let i = 0; i < 6; i++) {
        await vscode.commands.executeCommand("cursorRight");
    }
    await vscode.commands.executeCommand("cursorRightSelect");
    await sleep(1000);
    await vscode.commands.executeCommand('rainbow-csv.RainbowSeparator');
    await sleep(2000);
    log_message(`languageId for small_movies.pipe after RainbowSeparator: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'csv (pipe)');
    await vscode.commands.executeCommand('rainbow-csv.RainbowSeparatorOff');
    await sleep(2000);
    log_message(`languageId for small_movies.pipe after RainbowSeparatorOff: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    await sleep(1000);
}


function test_range_position_contains_equivalence() {
    // Ensure equivalence of test double and native classes "contains" logic.
    let [vscode_range, vscode_position, test_double_range, test_double_position] = [null, null, null, null];

    // Simple test.
    vscode_range = new vscode.Range(1, 0, 1, 10);
    vscode_position = new vscode.Position(1, 4);
    test_double_range = new unit_tests.VscodeRangeTestDouble(1, 0, 1, 10);
    test_double_position = new unit_tests.VscodePositionTestDouble(1, 4);
    assert(vscode_range.contains(vscode_position));
    assert(test_double_range.contains(test_double_position));

    // Simple not contains test - different line.
    vscode_range = new vscode.Range(1, 0, 1, 10);
    vscode_position = new vscode.Position(2, 4);
    test_double_range = new unit_tests.VscodeRangeTestDouble(1, 0, 1, 10);
    test_double_position = new unit_tests.VscodePositionTestDouble(2, 4);
    assert(!vscode_range.contains(vscode_position));
    assert(!test_double_range.contains(test_double_position));

    // Simple not contains test - after last character.
    vscode_range = new vscode.Range(3, 5, 3, 10);
    vscode_position = new vscode.Position(3, 11);
    test_double_range = new unit_tests.VscodeRangeTestDouble(3, 5, 3, 10);
    test_double_position = new unit_tests.VscodePositionTestDouble(3, 11);
    assert(!vscode_range.contains(vscode_position));
    assert(!test_double_range.contains(test_double_position));

    // Contains test - last character.
    vscode_range = new vscode.Range(3, 5, 3, 10);
    vscode_position = new vscode.Position(3, 10);
    test_double_range = new unit_tests.VscodeRangeTestDouble(3, 5, 3, 10);
    test_double_position = new unit_tests.VscodePositionTestDouble(3, 10);
    assert(vscode_range.contains(vscode_position));
    assert(test_double_range.contains(test_double_position));

    // Contains test - first character.
    vscode_range = new vscode.Range(3, 5, 3, 10);
    vscode_position = new vscode.Position(3, 5);
    test_double_range = new unit_tests.VscodeRangeTestDouble(3, 5, 3, 10);
    test_double_position = new unit_tests.VscodePositionTestDouble(3, 5);
    assert(vscode_range.contains(vscode_position));
    assert(test_double_range.contains(test_double_position));

    // Not contains test - line before.
    vscode_range = new vscode.Range(3, 5, 3, 10);
    vscode_position = new vscode.Position(2, 5);
    test_double_range = new unit_tests.VscodeRangeTestDouble(3, 5, 3, 10);
    test_double_position = new unit_tests.VscodePositionTestDouble(2, 5);
    assert(!vscode_range.contains(vscode_position));
    assert(!test_double_range.contains(test_double_position));

    // Contains test - multiline range, but character is off - still contains.
    vscode_range = new vscode.Range(3, 5, 10, 4);
    vscode_position = new vscode.Position(3, 100);
    test_double_range = new unit_tests.VscodeRangeTestDouble(3, 5, 10, 4);
    test_double_position = new unit_tests.VscodePositionTestDouble(3, 100);
    assert(vscode_range.contains(vscode_position));
    assert(test_double_range.contains(test_double_position));
}


function test_autodetect_dialect_frequency_based() {
    let [doc_lines, active_doc, candidate_separators, max_num_chars_to_test, dialect_info] = [null, null, null, null, null];

    // Basic test.
    doc_lines = ['a1;a2', 'b1;b2', '#comment', 'c1;c2', 'd1;d2'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines);
    candidate_separators = [',', ';'];
    max_num_chars_to_test = 10000;
    dialect_info = extension.autodetect_dialect_frequency_based(active_doc, candidate_separators, max_num_chars_to_test);
    assert.deepEqual(['csv (semicolon)', ';', 'quoted'], dialect_info);

    // Empty doc - should return csv since this is the default (presumably doc has .csv extension in order to call this function).
    doc_lines = [];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines);
    candidate_separators = ['|', ' ', '\t', ',', ';'];
    max_num_chars_to_test = 10000;
    dialect_info = extension.autodetect_dialect_frequency_based(active_doc, candidate_separators, max_num_chars_to_test);
    assert.deepEqual(['csv', ',', 'quoted'], dialect_info);

    // Test max_num_chars_to_test effect on autodetection result.
    doc_lines = ['a|b|c|d,f|g|h|d', 'a,b', 'c,d', 'e,f', 'g,h', 'k,l', 'm,n', 'o,p'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines);
    candidate_separators = ['|', ',', ';'];
    assert.deepEqual(['csv (pipe)', '|', 'simple'], extension.autodetect_dialect_frequency_based(active_doc, candidate_separators, /*max_num_chars_to_test=*/10));
    assert.deepEqual(['csv', ',', 'quoted'], extension.autodetect_dialect_frequency_based(active_doc, candidate_separators, /*max_num_chars_to_test=*/10000));

    // Dynamic csv test.
    doc_lines = ['a$b', 'c$d', 'e$f', 'g,h', 'k,l'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines);
    candidate_separators = ['$', ',', ';'];
    assert.deepEqual(['dynamic csv', '$', 'simple'], extension.autodetect_dialect_frequency_based(active_doc, candidate_separators, /*max_num_chars_to_test=*/10000));

    // Skipping frequent dot and whitespace because they are in blocklist.
    doc_lines = ['a;  b...', 'c ;d...', 'e   ;f...', 'g  ; h...', 'k  l...'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines);
    candidate_separators = [' ', '.', ';'];
    assert.deepEqual(['csv (semicolon)', ';', 'quoted'], extension.autodetect_dialect_frequency_based(active_doc, candidate_separators, /*max_num_chars_to_test=*/10000));

    // Using default comma separator because the user configured ones have zero frequency. Not sure if this is the right behavior in this case though.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines);
    candidate_separators = [';', '\t'];
    assert.deepEqual(['csv', ',', 'quoted'], extension.autodetect_dialect_frequency_based(active_doc, candidate_separators, /*max_num_chars_to_test=*/10000));

    // Empty configured separators list.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines);
    candidate_separators = [];
    assert.deepEqual(['csv', ',', 'quoted'], extension.autodetect_dialect_frequency_based(active_doc, candidate_separators, /*max_num_chars_to_test=*/10000));
}


async function test_try_autoenable_rainbow_csv() {
    let [config, extension_context, doc_lines, active_doc] = [null, null, null, null];

    // Simple test. `other_fake.txt` in stop list doesn't prevent autodetection. Trailing space is not detected because the config option is set to 'false'.
    doc_lines = ['a|b', 'c|d  ', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set(['other_fake.txt'])};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('csv (pipe)', active_doc.languageId);
    assert.deepEqual([['fake.txt.csv (pipe)', {is_ok: true, first_trailing_space_line: null}]], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([['fake.txt', 'plaintext']], Array.from(extension_context.original_language_ids.entries()));

    // Simple test. No autodetection.
    doc_lines = ['a|b', 'c|d', 'e|f', 'g,h'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test that the autodetection doesn't happen if enable_separator_autodetection is false.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', false], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test `TAB` to -> '\t' conversion.
    doc_lines = ['a\tb', 'c\td', 'e\tf'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', false], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test stoplist.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set(['fake.txt'])};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // No filename - no autodetection.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, '', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Mysterious .git filename - no autodetection. TODO figure out why do we have these .git files.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.git', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Non-plaintext language id - no autodetection.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'foobar');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('foobar', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Non-plaintext language id but filename has .csv extension - autodetection.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.csv', 'csv');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('csv (pipe)', active_doc.languageId);
    assert.deepEqual([['fake.csv.csv (pipe)', {is_ok: true, first_trailing_space_line: null}]], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([['fake.csv', 'csv']], Array.from(extension_context.original_language_ids.entries()));

    // Test quoted_rfc policy autodetection for `,` and `;` separators.
    doc_lines = ['a,b', 'c,"d', 'a""sd""f', 'ef"', 'g,h', 'i,j'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('dynamic csv', active_doc.languageId);
    assert.deepEqual([['fake.txt.dynamic csv', {is_ok: true, first_trailing_space_line: null}]], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([['fake.txt', {delim: ',', policy: 'quoted_rfc'}]], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([['fake.txt', 'plaintext']], Array.from(extension_context.original_language_ids.entries()));

    // Test that quoted_rfc policy doesn't extend for other separators e.g. pipe `|`.
    doc_lines = ['a|b', 'c|"d', 'a""sd""f', 'ef"', 'g|h', 'i|j'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test trailing spaces detection.
    doc_lines = ['a|b', 'c  |d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set(['other_fake.txt'])};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', true], ['autodetection_min_line_count', 3], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('csv (pipe)', active_doc.languageId);
    assert.deepEqual([['fake.txt.csv (pipe)', {is_ok: true, first_trailing_space_line: 1}]], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([['fake.txt', 'plaintext']], Array.from(extension_context.original_language_ids.entries()));

    // Test too few lines for autodetection.
    doc_lines = ['a|b', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 4], ['comment_prefix', '#']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test autodetection with default comment prefix.
    doc_lines = ['a|b', '#comment', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('csv (pipe)', active_doc.languageId);
    assert.deepEqual([['fake.txt.csv (pipe)', {is_ok: true, first_trailing_space_line: null}]], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([['fake.txt', 'plaintext']], Array.from(extension_context.original_language_ids.entries()));

    // Test autodetection with custom comment prefix
    doc_lines = ['a|b', '$$comment', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '$$']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('csv (pipe)', active_doc.languageId);
    assert.deepEqual([['fake.txt.csv (pipe)', {is_ok: true, first_trailing_space_line: null}]], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([['fake.txt', 'plaintext']], Array.from(extension_context.original_language_ids.entries()));

    // Test no autodetection with default comment prefix.
    doc_lines = ['a|b', '$$comment', 'c|d', 'e|f'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test second candidate (TAB) more popular than the first (comma).
    doc_lines = ['a,b\tc\td', 'a,b\tc\td', 'a,b\tc\td', 'a,b\tc\td'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', 'TAB']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3], ['comment_prefix', '$$']]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('tsv', active_doc.languageId);
    assert.deepEqual([['fake.txt.tsv', {is_ok: true, first_trailing_space_line: null}]], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([['fake.txt', 'plaintext']], Array.from(extension_context.original_language_ids.entries()));

    // Test inconsistent num of fields.
    doc_lines = ['a|b', 'c|d', 'e|f', 'e|f|g'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test defective line (quoting error).
    doc_lines = ['a,b', 'c,d', 'e,"fsdf""', 'g,h'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', ';', '\t', '|']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test switch to frequency based autodetection.
    doc_lines = ['a,b,c', 'a,b,c', 'a,b,c', 'a,b\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tc'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.csv', 'csv');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', 'TAB']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('tsv', active_doc.languageId);
    // In case of frequency based autodetection we will have lint results cache empty - this is probably fine because we will recalculate it later after enabling rainbow features for the file.
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([['fake.csv', 'csv']], Array.from(extension_context.original_language_ids.entries()));

    // Test that autodetected language matches the original language id.
    doc_lines = ['a,b,c', 'a,b,c', 'a,b ,c', '#comment'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.csv', 'csv');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', 'TAB']], ['csv_lint_detect_trailing_spaces', true], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('csv', active_doc.languageId);
    assert.deepEqual([['fake.csv.csv', {is_ok: true, first_trailing_space_line: 2}]], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    // Original language id should not be set since it matches the autodetected language
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test that autodetection_min_line_count also applies to the record count, not just source lines - do not count comment lines.
    doc_lines = ['Device ids, use with caution!', '#a20', '#a50', '#a30'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', 'TAB']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));

    // Test that autodetection_min_line_count also applies to the record count, not just source lines - count multiline record once.
    doc_lines = ['hello,"world', 'asd,fasf', '', 'sadf', 'fasdf"'];
    active_doc = new unit_tests.VscodeDocumentTestDouble(doc_lines, 'fake.txt', 'plaintext');
    extension_context = {lint_results: new Map(), dynamic_document_dialects: new Map(), original_language_ids: new Map(), autodetection_stoplist: new Set()};
    config = new Map([['enable_separator_autodetection', true], ['autodetect_separators', [',', 'TAB']], ['csv_lint_detect_trailing_spaces', false], ['autodetection_min_line_count', 3]]);
    await extension.try_autoenable_rainbow_csv(unit_tests.vscode_test_double, config, extension_context, active_doc);
    assert.equal('plaintext', active_doc.languageId);
    assert.deepEqual([], Array.from(extension_context.lint_results.entries()));
    assert.deepEqual([], Array.from(extension_context.dynamic_document_dialects.entries()));
    assert.deepEqual([], Array.from(extension_context.original_language_ids.entries()));
}


async function run() {
    try {
        log_message('Starting tests');

        assert.equal(-1, [1, 2, 3].indexOf(0));

        assert(vscode.workspace.workspaceFolders);
        assert.equal(1, vscode.workspace.workspaceFolders.length);
        let workspace_folder_uri = vscode.workspace.workspaceFolders[0].uri;

        test_range_position_contains_equivalence();

        unit_tests.test_all();

        test_autodetect_dialect_frequency_based();

        await test_try_autoenable_rainbow_csv();

        await test_no_autodetection(workspace_folder_uri);
        if (!is_web_ext) {
            // Ensure that opening non-csv files doesn't cause rainbow csv to import relatively heavy lazy-loaded code.
            // There is no point to check this in web since all of the files are bundled into a single script anyway.
            let state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_initialization_state: true});
            assert(state_report.initialized);
            assert(!state_report.lazy_loaded);
        }

        await test_autodetection(workspace_folder_uri);
        await test_manual_enable_disable(workspace_folder_uri);

        await test_huge_file(workspace_folder_uri);

        await test_dynamic_csv(workspace_folder_uri);

        if (is_web_ext) {
            await test_rbql_web(workspace_folder_uri);
        } else {
            await test_rbql_node(workspace_folder_uri);
        }

        if (!is_web_ext) {
            // Sanity check that after using advanced functionality such as RBQL, the non-basic code is lazy loaded.
            let state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_initialization_state: true});
            assert(state_report.initialized);
            assert(state_report.lazy_loaded);
        }

        await test_align_shrink_lint(workspace_folder_uri);
        await test_column_edit(workspace_folder_uri);

        log_message('Finishing tests');
    } catch (e) {
        log_message('Error: tests have failed. Exception:');
        log_message(String(e));
        log_message(String(e.stack));
    }
}

exports.run = run;
