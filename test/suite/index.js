const assert = require('assert');
const os = require('os');

const vscode = require('vscode');

const is_web_ext = (os.homedir === undefined); // Runs as web extension in browser.


// TODO make RBQL command wait for the result to reduce the timeout.
const poor_rbql_async_design_workaround_timeout = 6000;


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function log_message(msg) {
    console.log('###RAINBOW_CSV_UNIT_TEST_MESSAGE### ' + msg);
}


async function test_rbql_node(workspace_folder_uri) {
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'university_ranking.csv');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);

    // Test Python query.
    let test_task = {rbql_backend: "python", rbql_query: "select top 20 a1, math.ceil(float(a4) * 100), a2, 'foo bar' where NR > 1 order by a2"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    let length_after_query = active_doc.getText().length;
    log_message(`Lenght after python query: ${length_after_query}`)
    assert.equal(805, length_after_query); // wc -c gives 785 characters length. Probably VSCode uses '\r\n' as line ends

    // Test JS query.
    test_task = {rbql_backend: "js", rbql_query: "select a2 * 10, a3, a3.length order by a3.length limit 10"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Lenght after js query: ${length_after_query}`)
    assert.equal(268, length_after_query);

    // Test RBQL query error reporting.
    test_task = {rbql_backend: "python", rbql_query: "select nonexistent_function(a1)"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    let state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_last_rbql_report: true});
    assert.equal('query execution', state_report.error_type);
    assert.equal("At record 1, Details: name 'nonexistent_function' is not defined", state_report.error_msg);

    // Test with multiline records.
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'synthetic_rfc_newline_data.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    test_task = {rbql_backend: "js", rbql_query: "select '<<<<<', a3, a2, a1, '>>>>> NR: ' + NR", enable_rfc_newlines: true};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Lenght after js multiline-record query: ${length_after_query}`)
    assert.equal(645, length_after_query);
}


async function test_rbql_web(workspace_folder_uri) {
    let uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'university_ranking.csv');
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);

    let test_task = {rbql_backend: "js", rbql_query: "select top 20 a1, Math.ceil(parseFloat(a4) * 100), a2, 'foo bar' where NR > 1 order by a2"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    let length_after_query = active_doc.getText().length;
    log_message(`Lenght after first js query: ${length_after_query}`)
    // 784 instead of 785 because no trailing '\n' at the end of file.
    assert.equal(784, length_after_query);

    test_task = {rbql_backend: "js", rbql_query: "select a2 * 10, a3, a3.length order by a3.length limit 10"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Lenght after second js query: ${length_after_query}`)
    // 267 instead of 268 because no trailing '\n' at the end of file.
    assert.equal(267, length_after_query);

    // Test RBQL query error reporting.
    test_task = {rbql_backend: "js", rbql_query: "select nonexistent_function(a1)"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    let state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_last_rbql_report: true});
    assert.equal('query execution', state_report.error_type);
    assert.equal("At record 1, Details: nonexistent_function is not defined", state_report.error_msg);

    // Test with multiline records.
    uri = vscode.Uri.joinPath(workspace_folder_uri, 'test', 'csv_files', 'synthetic_rfc_newline_data.csv');
    active_doc = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    test_task = {rbql_backend: "js", rbql_query: "select '<<<<<', a3, a2, a1, '>>>>> NR: ' + NR", enable_rfc_newlines: true};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(poor_rbql_async_design_workaround_timeout);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Lenght after js multiline-record query: ${length_after_query}`)
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
    assert.equal(lint_report, 'OK');
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
    assert(lint_report.indexOf('Number of fields is not consistent') != -1);
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


async function run() {
    try {
        log_message('Starting tests');

        assert.equal(-1, [1, 2, 3].indexOf(0));

        assert(vscode.workspace.workspaceFolders);
        assert.equal(1, vscode.workspace.workspaceFolders.length);
        let workspace_folder_uri = vscode.workspace.workspaceFolders[0].uri;

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

        if (!is_web_ext) {
            // Ensure that basic operations don't cause rainbow csv to lazy load unnecessary code.
            let state_report = await vscode.commands.executeCommand('rainbow-csv.InternalTest', {check_initialization_state: true});
            assert(state_report.initialized);
            assert(!state_report.lazy_loaded);
        }

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
