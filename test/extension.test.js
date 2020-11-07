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
            let lint_report = rainbow_csv.csv_lint(active_doc, true);
            assert.equal(lint_report, 'OK');
            await sleep(2000);
            
            await vscode.commands.executeCommand('rainbow-csv.Shrink');
            let length_shrinked = active_doc.getText().length;
            log_message(`Shrinked length: ${length_shrinked}`)
            assert.equal(length_original, length_shrinked);
            await sleep(500);
            
            let text_with_comma = 'foobar,';
            await vscode.commands.executeCommand('default:type', { text: text_with_comma });
            lint_report = rainbow_csv.csv_lint(active_doc, true);
            assert(lint_report.indexOf('Number of fields is not consistent') != -1);
            await sleep(500);
            
            for (let i = 0; i < text_with_comma.length; i++) {
                vscode.commands.executeCommand("deleteLeft");
            }
            
            await sleep(500);
            uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'movies.txt'));
            active_doc = await vscode.workspace.openTextDocument(uri);
            editor = await vscode.window.showTextDocument(active_doc);
            length_original = active_doc.getText().length;
            log_message(`Original length: ${length_original}`)
            for (let i = 0; i < 10; i++) {
                vscode.commands.executeCommand("cursorRight");
            }
            await sleep(1000);
            vscode.commands.executeCommand("rainbow-csv.ColumnEditAfter");
            await sleep(1000);
            await vscode.commands.executeCommand('default:type', { text: text_with_comma });
            length_after_column_edit = active_doc.getText().length;
            log_message(`Length after column edit: ${length_after_column_edit}`)
            assert.equal(length_original + active_doc.lineCount * text_with_comma.length, length_after_column_edit);
            await sleep(1000);
            for (let i = 0; i < text_with_comma.length; i++) {
                vscode.commands.executeCommand("deleteLeft");
            }
            await sleep(1000);
            length_after_delete = active_doc.getText().length;
            assert.equal(length_original, length_after_delete);
            
            
            uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'lorem_ipsum.txt'));
            active_doc = await vscode.workspace.openTextDocument(uri);
            log_message(`languageId for lorem_ipsum.txt: ${active_doc.languageId}`)
            assert.equal(active_doc.languageId, 'plaintext');
            editor = await vscode.window.showTextDocument(active_doc);
            await sleep(1000);
            
            uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'lorem_ipsum'));
            active_doc = await vscode.workspace.openTextDocument(uri);
            log_message(`languageId for lorem_ipsum: ${active_doc.languageId}`)
            assert.equal(active_doc.languageId, 'plaintext');
            editor = await vscode.window.showTextDocument(active_doc);
            await sleep(1000);
            
            uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'university_ranking_semicolon.txt'));
            active_doc = await vscode.workspace.openTextDocument(uri);
            editor = await vscode.window.showTextDocument(active_doc);
            log_message(`languageId for university_ranking_semicolon.txt: ${active_doc.languageId}`)
            assert.equal(active_doc.languageId, 'csv (semicolon)');
            await sleep(1000);

            uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'small_movies.pipe'));
            active_doc = await vscode.workspace.openTextDocument(uri);
            log_message(`languageId for small_movies.pipe: ${active_doc.languageId}`)
            assert.equal(active_doc.languageId, 'plaintext');
            editor = await vscode.window.showTextDocument(active_doc);
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

            // One approach to set selection:
            //const cur_pos: vscode.Position = editor.selection.active;
            //editor.selection = new vscode.Selection(cur_pos, cur_pos);

            await sleep(1000);
            log_message('Finishing tests');
        } catch (e) {
            log_message('Error: tests have failed. Exception:');
            log_message(String(e));
        }
    });
});
