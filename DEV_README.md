## Instructions

### Key Info
* Surprising VSCode filetype (language mode in the bottom-right corner) persistence behaviour:
  - filetypes are often (or always?) preserved across restarts, even "Dynamic CSV".
  - filetypes are not preserved on file re-open (both non-preview and preview modes)
  - sometimes filetype are not preserved across tab back-and-forth switching (let's call this "curious doc reopening" problem)
    this is reproducible when first selecting a manual separator e.g. `~#~`, then switching to "plain text" through the lang selection menu, than back to "dynamic csv".
    Now "Dynamic CSV" and highlighting would disappear if user clicks another tab and back - the "dynamic csv" version of the doc would be closed and plaintext doc opened.
    It is possible to "fix" this scenario for a particular doc by explicitly closing and opening it again.
    Apparently this also affects the reverse situation and switch from plaintext back to e.g. TSV when we select TSV manually, then click "Rainbow Off", switch tabs and it is "On" again. So somehow manual "language mode" selection is more persistent than setTextDocumentLanguage effect.

* "Dynamic CSV" highlighting might not work because of the conflict with some other extensions.
* To ensure the required behaviour we will use "defensive programming" paradigm and there might be some redundancy in the method invocation (e.g. we might disable/enable something twice both on doc opening and closing), this is fine as long as the invocations are idempotent.



### Pre-publishing checklist
* Make sure to run unit tests in browser.
* Make sure that "sticky header" feature works if enabled.
* Make sure that "Dynamic CSV" -> "Dynamic CSV" switch from one separator to another works.
* Run `npm run lint`


### Debugging the extension:
#### For standard VSCode:
1. Open rainbow_csv directory in VSCode  
2. Make sure you have "Extension" run mode enabled
3. Click "Run" or F5


#### For web-based VSCode:
1. Run `npm install` - OK to run in WSL.
2. Run `npm run compile-web && npm run start-web-server` - OK to run in WSL. - This should start a local server at http://localhost:3000/
3. Point your browser to http://localhost:3000/
It is possible to run this in windows cmd too, but it could be that the node_modules dir has to be deleted and installed from scratch.
The difference between running in win and in WSL is that in WSL it would only run with `--browser=none` option and this option doesn't run unit tests automatically which could be an issue if you want to run tests instead of manual debugging.

NOTE: if `npm run test-in-browser` fails with an error it could show a message telling to install/update playwright - do it (it will also print the command, something like: `npx playwright install`).

### Running unit tests for the extension OUTSIDE VSCode:
#### For standard VSCode:
1. **IMPORTANT** Make sure you have no open VSCode instances running, all VSCode windows are closed (otherwise will might get some weird caching/webworker errors or other issues)!
2. run `npm install` (If you have WSL - run in Windows, don't run in WSL).
3. run `npm run test` in Windows (If you have WSL - run in Windows, don't run in WSL). Make sure that the tests are successful.

#### For web-based VSCode:
1. run `npm install` (If you have WSL - run in Windows, don't run in WSL).
2. run `npm run compile-web` (If you have WSL - run in Windows, don't run in WSL). This will combine all scripts into a single web script and put it into the `dist` folder.
3. run `npm run test-in-browser` (If you have WSL - run in Windows, don't run in WSL). This will open a new browser windows and run all the unit tests. Make sure that the tests are successful.

NOTE: if `npm run test-in-browser` fails with an error it could show a message telling to install/update playwright - do it (it will also print the command, something like: `npx playwright install`).


### Running unit tests for the extension INSIDE VSCode:
1. In console in rainbow_csv directory run `npm install` - OK to run the command in WSL while launching in Windows. This will install the dependencies, including `vscode/lib/testrunner`
2. Open rainbow_csv directory in VSCode switch to "Extension Tests" mode and click run
**IMPORTANT** for some reason unit tests that are run from inside VSCode will often start with some files reopened from the previous session, this among other issues could cause `is_lazy_loaded` check to fail. An only known workaround is to quickly close all tabs in the test run and then restart the tests.


Example of minimalistic test setup:
https://github.com/microsoft/vscode-extension-samples/tree/main/helloworld-test-sample



#### Debuging
Looks like it is possible to directly run scripts from package.json with `npx` like this:
```
npx vscode-test-web --help
```
And apparently another option to execute this command is (never tested):
```
npx @vscode/test-web --extensionDevelopmentPath=$extensionFolderPath $testDataPath
```

Options available for vscode-test-web
* version
`'insiders' | 'stable' | 'sources' [Optional, default 'insiders']`

* browser
`'chromium' | 'firefox' | 'webkit' | 'none': The browser to launch. [Optional, defaults to 'chromium']`
If `none` is provided it wouldn't run unit test and it wouldn't kill the server when the browser window is closed.

If exceptions happens in extension.js you will be able to see it in the browser console (but the line number would be wrong).


#### Issues
* FS mount not working: https://github.com/microsoft/vscode-test-web/issues/16


### Running the browser version for vscode.dev
The npx command `npx serve --cors -l 5000` failed in WSL with `cb.apply is not a function` error.
The same command worked as expected from Windows cmd.
Steps:
1. Run `npx serve --cors -l 5000` - this may not work in WSL, in this case run in windows cmd. This local server uses `http` instead of `https` and because of that VSCode will not work with it directly, although the docs say otherwise (https://code.visualstudio.com/api/extension-guides/web-extensions#test-your-web-extension-in-on-vscode.dev) - it will just produce some cors/wss content security policy related errors in the log. So you need to do step 2.
2. In another cmd tab run another commmand: `npx localtunnel -p 5000` - this will create a "tunnel" server pointing to the server from the first command - this will produce a link like `https://rotten-snake-42.loca.lt/`
3. Follow the `https://rotten-snake-42.loca.lt/` link and press the button - this will show the content of your extension folder - https server is working.
4. Go to vscode.dev -> Ctrl+Shift+P -> run Developer: Install Web Extension... -> Copy the `https://rotten-snake-42.loca.lt/` link. In my experience this will work only with https urls. If you use http, the extension will be sort of "installed" - it will be listed in the installed extension pannel but the main extension.js won't be loaded so all the logic will be missing from it.


### Publishing
1. Make sure you have webpack installed: run `npm install` (Better to avoid running this in WSL).
   Although this would create `node_modules/` and `package-lock.json` file this is not a problem because they are excluded from final package via the `.vscodeignore` file.
2. Run `vsce publish minor -p <key>` as usual. vsce will also automatically run `vscode:prepublish` / `npm run package-web` command.

### Publishing to openvsx
1. Make sure you have webpack installed: run `npm install` (Better to avoid running this in WSL).
   Although this would create `node_modules/` and `package-lock.json` file this is not a problem because they are excluded from final package via the `.vscodeignore` file.
2. Run `npx ovsx publish -p <openvsx_token>`

Unlike vsce publishing for the official Microsoft VSCode marketplace, ovsx tool does not need to be provided with version increment specification (such as major/minor/fix), instead it will just use the version from package.json file which is very convenient. And it will also won't try to update that version value in package.json during the publishing process.

See more docs here: https://github.com/eclipse/openvsx/wiki/Publishing-Extensions


### Testing for remote development
1. Install code on the remote machine. Note: In my case "snap" installation didn't work, but the deb package worked without issues.
2. Run `code tunnel`, see more here: https://code.visualstudio.com/docs/remote/tunnels#_using-the-code-cli
3. Access the link from the browser or through the desktop VSCode app using `Remote - Tunnels` extension https://code.visualstudio.com/blogs/2022/12/07/remote-even-better
   Enter `Remote - Tunnels: Connect to Tunnel` command in the pallete.





### Generating documentation with showdown
In order to generate RBQL documentation use showdown - based markdown_to_html.js script from junk/rainbow_stuff
Usage: `node markdown_to_html.js ~/vscode_rainbow_csv/rbql_core/README.md out.html`



# TODO LIST
* Improve RBQL encoding handling logic when VScode encoding info API is implemented, see https://github.com/microsoft/vscode/issues/824.

* Consider keeping only one open RBQL console at any time - if another one opens automatically close the previous one.

* DEBUG: Add a huge no-op loop on startup in order to reproduce/emulate high-cpu load error from #55.

* Support virtual header for rbql_csv.

* Consider replacing the RBQL query text input with scrollable textarea - it has a drawback that on enter it will go to the next line instead running the query.

* Store VSCode documents instead of file paths in result_set_parent_map so that the map can be used in web version. And the autodetection_stoplist also should be doc based to work in web.

* Support JOIN queries in web version.

* Support all commands in web version

* Get rid of `then` entirely

* Merge rbql_query_web and rbql_query_node

* Show column info in statusline even when there are consistency issues, but highlight it in red/yellow

* Add feature to decorate separators with a transparent box or different color or something, see the opened issue.

* Consider speeding up autodetection by adding parse_rfc option. If it is false - we can only parse top N=10 lines and skip setting lint cache key until the actual lint.

* Consider using RFC-like syntax by ajhyndman, see https://github.com/mechatroner/vscode_rainbow_csv/issues/4

* Consider removing double quote autoclosing from non-csv/scsv dialects when native rfc csv is enabled.

* Manual selection of separator is not remembered in preview mode (unlike filetype selection through the menu) - consider remembering the selected separator in dialect_info (this is already done) with the special "is_manual" flag and during doc_open restore the dialect.

* FIXME: Unlike manual filetype selection, setTextDocumentLanguage sometimes doesn't survive tab switch, this is especially reproducible with `dynamic csv` language and subsequent `Rainbow Off` command. Figure out how to overcome this (perhaps it is possible to overcome this with `preview=fase` option in all `showTextDocument` calls?)

* Consider getting rid of Rainbow Off button.

* Alignment: Instead of extra trailing whitespace better use extra starting whitespace: `,hello ,` -> `, hello,`

* Consider adding optional "keep-it-dark" mode that would force dark color theme even if all other filetypes use light color theme to improve csv readability.

* Consider using readonly virtual documents for RBQL query results and align/shrink command results, see https://code.visualstudio.com/api/extension-guides/virtual-documents (use custom scheme with them too) 

* Consider setting `preview=fase` option in all `showTextDocument` calls.

* Add `"csv (tab)"` alias to TSV language if/when https://github.com/microsoft/vscode/issues/167208 is resolved

* Fix or consider getting rid of hover syntax highlighting, it doesn't always work perhaps due to https://github.com/microsoft/vscode/issues/53723.

* Fix sticky header for 'Set Header Line' command case.


## RFC Support plan
We need:
1. Full doc tokenization (rbql + rbql UI preview sampling + lint + autodetection) - 100% correct, doesn't have to use VSCode ranges.
2. Fragment tokenization (hover + highlighting) - best effort, fast, should use VSCode ranges.


## OTHER
Token modifiers to use if needed:
```
const tokenModifiers = ['rainbow2', 'rainbow3', 'rainbow4', 'rainbow5', 'rainbow6', 'rainbow7', 'rainbow8', 'rainbow9', 'rainbow10', 'name', 'function', 'parameter', 'numeric', 'type', 'bold'];
const modifier_sequences = [[], ['rainbow2'], ['name', 'function', 'rainbow3'], ['rainbow4'], ['rainbow5'], ['parameter', 'rainbow6'], ['numeric', 'rainbow7'], ['name', 'type', 'rainbow8'], ['bold', 'rainbow9'], 'rainbow10'];
```


#### Maximum supported file size in VSCode
https://stackoverflow.com/questions/53625687/what-is-the-largest-filesize-supported-by-vs-code-syntax-highlighting
20MB Or 300K lines (avg 66 chars per line).
