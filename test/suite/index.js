const assert = require('assert');
const path = require('path');

const vscode = require('vscode');

const is_web_ext = (path.resolve === undefined); // Runs as web extension in browser.
const test_dir = is_web_ext ? null : path.resolve(__dirname, '..');


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function log_message(msg) {
    console.log('###RAINBOW_CSV_UNIT_TEST_MESSAGE### ' + msg);
}


async function test_rbql() {
    let uri = vscode.Uri.file(path.join(test_dir, 'csv_files', 'university_ranking.csv'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);

    let test_task = {"rbql_backend": "python", "rbql_query": "select top 20 a1, math.ceil(float(a4) * 100), a2, 'foo bar' where NR > 1 order by a2"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(6000);
    active_doc = vscode.window.activeTextEditor.document;
    let length_after_query = active_doc.getText().length;
    log_message(`Lenght after python query: ${length_after_query}`)
    assert.equal(805, length_after_query); // wc -c gives 785 characters length. Probably VSCode uses '\r\n' as line ends

    test_task = {"rbql_backend": "js", "rbql_query": "select a2 * 10, a3, a3.length order by a3.length limit 10"};
    await vscode.commands.executeCommand('rainbow-csv.RBQL', test_task);
    await sleep(6000);
    active_doc = vscode.window.activeTextEditor.document;
    length_after_query = active_doc.getText().length;
    log_message(`Lenght after js query: ${length_after_query}`)
    assert.equal(268, length_after_query);
}


async function test_align_shrink_lint() {
    let uri = vscode.Uri.file(path.join(test_dir, 'csv_files', 'university_ranking.csv'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    let length_original = active_doc.getText().length;
    log_message(`Original length: ${length_original}`)
    await sleep(2000);

    await vscode.commands.executeCommand('rainbow-csv.Align');
    let length_aligned = active_doc.getText().length;
    log_message(`Aligned length: ${length_aligned}`)
    assert(length_aligned > length_original);
    let lint_report = await vscode.commands.executeCommand('rainbow-csv.CSVLint');
    assert.equal(lint_report, 'OK');
    await sleep(2000);

    await vscode.commands.executeCommand('rainbow-csv.Shrink');
    let length_shrinked = active_doc.getText().length;
    log_message(`Shrinked length: ${length_shrinked}`)
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


async function test_column_edit() {
    let uri = vscode.Uri.file(path.join(test_dir, 'csv_files', 'movies.txt'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    let length_original = active_doc.getText().length;
    log_message(`Original length: ${length_original}`)
    for (let i = 0; i < 10; i++) {
        await vscode.commands.executeCommand("cursorRight");
    }
    await sleep(1000);
    await vscode.commands.executeCommand("rainbow-csv.ColumnEditAfter");
    await sleep(1000);
    let text_with_comma = 'foobar,';
    await vscode.commands.executeCommand('default:type', { text: text_with_comma });
    let length_after_column_edit = active_doc.getText().length;
    log_message(`Length after column edit: ${length_after_column_edit}`)
    assert.equal(length_original + active_doc.lineCount * text_with_comma.length, length_after_column_edit);
    await sleep(1000);
    for (let i = 0; i < text_with_comma.length; i++) {
        await vscode.commands.executeCommand("deleteLeft");
    }
    await sleep(1000);
    let length_after_delete = active_doc.getText().length;
    assert.equal(length_original, length_after_delete);
}


async function test_no_autodetection() {
    let uri = vscode.Uri.file(path.join(test_dir, 'csv_files', 'lorem_ipsum.txt'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for lorem_ipsum.txt: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    let editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    uri = vscode.Uri.file(path.join(__dirname, 'index.js'));
    active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for index.js: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'javascript');
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);

    uri = vscode.Uri.file(path.join(test_dir, 'csv_files', 'lorem_ipsum'));
    active_doc = await vscode.workspace.openTextDocument(uri);
    log_message(`languageId for lorem_ipsum: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'plaintext');
    editor = await vscode.window.showTextDocument(active_doc);
    await sleep(1000);
}


async function test_autodetection() {
    let uri = vscode.Uri.file(path.join(test_dir, 'csv_files', 'university_ranking_semicolon.txt'));
    let active_doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(active_doc);
    log_message(`languageId for university_ranking_semicolon.txt: ${active_doc.languageId}`)
    assert.equal(active_doc.languageId, 'csv (semicolon)');
    await sleep(1000);
}


async function test_manual_enable_disable() {
    let uri = vscode.Uri.file(path.join(test_dir, 'csv_files', 'small_movies.pipe'));
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
        
        if (!is_web_ext) {
            await test_rbql();
            await test_align_shrink_lint();
            await test_column_edit();
            await test_no_autodetection();
            await test_autodetection();
            await test_manual_enable_disable();
        }

        log_message('Finishing tests');
    } catch (e) {
        log_message('Error: tests have failed. Exception:');
        log_message(String(e));
        log_message(String(e.stack));
    }
}

exports.run = run;
