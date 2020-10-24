/* global suite, test */

//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
const assert = require('assert');
const path = require('path');

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = require('vscode');
const myExtension = require('../extension');


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", function() {

    // Defines a Mocha unit test
    test("Something 1", async () => {
        const uri = vscode.Uri.file(path.join(__dirname, 'csv_files', 'university_ranking.csv'));
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        await sleep(500);
        //assert.equal(-1, [1, 2, 3].indexOf(5));
        //assert.equal(-1, [1, 2, 3].indexOf(0));
    });
});
