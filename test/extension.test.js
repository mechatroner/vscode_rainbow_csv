/* global suite, test */

// This test uses Mocha test framework

// Example command to run from terminal (works in WSL too): code --extensionDevelopmentPath="C:\wsl_share\vscode_rainbow_csv" --extensionTestsPath="C:\wsl_share\vscode_rainbow_csv\test" --wait

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const vscode = require('vscode');
const rainbow_csv = require('../extension');

const crypto = require('crypto');

const log_file_path = path.join(__dirname, 'rainbow_csv.test.log');


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function calc_str_md5(str) {
    return crypto.createHash('md5').update(str, 'utf-8').digest('hex');
}


function log_message(msg) {
    fs.appendFileSync(log_file_path, msg + '\n');
}



async function test_rbql() {
    let uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'university_ranking.csv'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    let test_config_path = path.join(__dirname, 'test_config.json')

    let test_config = {"rbql_backend": "python", "rbql_query": "select top 20 a1, math.ceil(float(a.total_score) * 100), a.university_name, 'foo bar' where NR > 1 order by a.university_name"};
    fs.writeFileSync(test_config_path, JSON.stringify(test_config));
    await sleep(1000);
    await vscode.commands.executeCommand('rainbow-csv.SetIntegrationTestMode');
    await vscode.commands.executeCommand('rainbow-csv.RBQL');
    await sleep(6000);
    active_doc = vscode.window.activeTextEditor.document;
    let length_after_query = active_doc.getText().length;
    log_message(`Lenght after python query: ${length_after_query}`)
    assert.equal(805, length_after_query); // wc -c gives 785 characters length. Probably VSCode uses '\r\n' as line ends

    test_config = {"rbql_backend": "js", "rbql_query": "select a2 * 10, a3, a3.length order by a3.length limit 10"};
    fs.writeFileSync(test_config_path, JSON.stringify(test_config));
    await sleep(1000);
    await vscode.commands.executeCommand('rainbow-csv.SetIntegrationTestMode');
    await vscode.commands.executeCommand('rainbow-csv.RBQL');
    await sleep(6000);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Lenght after js query: ${length_after_query}`)
    assert.equal(268, length_after_query);
}


async function test_align_shrink_lint() {
    let uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'university_ranking.csv'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    let length_original = active_doc.getText().length;
    log_message(`Original length: ${length_original}`)
    await sleep(2000);
    
    await vscode.commands.executeCommand('rainbow-csv.Align');
    let length_aligned = active_doc.getText().length;
    log_message(`Aligned length: ${length_aligned}`)
    assert(length_aligned > length_original);
    let lint_report = rainbow_csv.csv_lint(active_doc, true); // FIXME this is not reliable to call this method, use command instead, we are actually using non-activated version of rainbow_csv here
    assert.equal(lint_report, 'OK');
    await sleep(2000);
    
    await vscode.commands.executeCommand('rainbow-csv.Shrink');
    let length_shrinked = active_doc.getText().length;
    log_message(`Shrinked length: ${length_shrinked}`)
    assert.equal(length_original, length_shrinked);
    await sleep(500);
    
    let text_with_comma = 'foobar,';
    await vscode.commands.executeCommand('default:type', { text: text_with_comma });
    lint_report = rainbow_csv.csv_lint(active_doc, true); // FIXME this is not reliable to call this method, use command instead, we are actually using non-activated version of rainbow_csv here
    assert(lint_report.indexOf('Number of fields is not consistent') != -1);
    await sleep(500);
    
    for (let i = 0; i < text_with_comma.length; i++) {
        vscode.commands.executeCommand("deleteLeft");
    }
    await sleep(500);
}


async function test_column_edit() {
    let uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'movies.txt'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    let length_original = active_doc.getText().length;
    log_message(`Original length: ${length_original}`)
    for (let i = 0; i < 10; i++) {
        vscode.commands.executeCommand("cursorRight");
    }
    await sleep(1000);
    vscode.commands.executeCommand("rainbow-csv.ColumnEditAfter");
    await sleep(1000);
    let text_with_comma = 'foobar,';
    await vscode.commands.executeCommand('default:type', { text: text_with_comma });
    let length_after_column_edit = active_doc.getText().length;
    log_message(`Length after column edit: ${length_after_column_edit}`)
    assert.equal(length_original + active_doc.lineCount * text_with_comma.length, length_after_column_edit);
    await sleep(1000);
    for (let i = 0; i < text_with_comma.length; i++) {
        vscode.commands.executeCommand("deleteLeft");
    }
    await sleep(1000);
    let length_after_delete = active_doc.getText().length;
    assert.equal(length_original, length_after_delete);
}


async function test_no_autodetection() {
    let uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'lorem_ipsum.txt'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for lorem_ipsum.txt: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    let editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    uri = vscode.Uri.file(path.join(__dirname, 'extension.test.js'));
    active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for extension.test.js: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'javascript');
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    
    uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'lorem_ipsum'));
    active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for lorem_ipsum: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
}


async function test_autodetection() {
    let uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'university_ranking_semicolon.txt'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    log_message(`languageId for university_ranking_semicolon.txt: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'csv (semicolon)');
    await sleep(1000);
}


async function test_manual_enable_disable() {
    let uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'small_movies.pipe'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for small_movies.pipe: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    let editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
    for (let i = 0; i < 6; i++) {
        vscode.commands.executeCommand("cursorRight");
    }
    vscode.commands.executeCommand("cursorRightSelect");
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


// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", function() {

    this.timeout(0); // Disable Mocha timeouts

    // Defines a Mocha unit test
    test("Test 1", async () => {
        try {
            fs.unlinkSync(log_file_path);
        } catch (e) {
            if (String(e).indexOf('no such file') == -1)
                throw e;
        }
        try {
            log_message('Starting tests');

            assert.equal(-1, [1, 2, 3].indexOf(0));

            await test_rbql();
            await test_align_shrink_lint();
            await test_column_edit();
            await test_no_autodetection();
            await test_autodetection();
            await test_manual_enable_disable();

            log_message('Finishing tests');
        } catch (e) {
            log_message('Error: tests have failed. Exception:');
            log_message(String(e));
            log_message(String(e.stack));
        }
    });
});
