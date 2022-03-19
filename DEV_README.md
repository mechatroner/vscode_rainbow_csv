## Instructions

### Debugging the extension:
#### For standard VSCode:
1. Open rainbow_csv directory in VSCode  
2. Make sure you have "Extension" run mode enabled
3. Click "Run" or F5


#### For web-based VSCode:
1. Run `npm install --only=dev` - OK to run in WSL
2. Run `npm run compile-web && npm run start-web-server` - OK to run in WSL. - This should start a local server at http://localhost:3000/
3. Point your browser to http://localhost:3000/
It is possible to run this in windows cmd too, but it could be that the node_modules dir has to be deleted and installed from scratch.
The difference between running in win and in WSL is that in WSL it would only run with `--browser=none` option and this option doesn't run unit tests automatically which could be an issue if you want to run tests instead of manual debugging.


### Running unit tests for the extension inside VSCode:
#### For standard VSCode:
1. **IMPORTANT** Make sure you have no open VSCode instances running, all VSCode windows are closed!
2. run `npm install --only=dev` (If you have WSL - run in Windows, don't run in WSL).
3. run `npm run test` in Windows (If you have WSL - run in Windows, don't run in WSL). Make sure that the tests are successful.

#### For web-based VSCode:
1. run `npm install` (If you have WSL - run in Windows, don't run in WSL).
2. run `compile-web` (If you have WSL - run in Windows, don't run in WSL). This will combine all scripts into a single web script and put it into the `dist` folder.
3. run `npm run test-in-browser` (If you have WSL - run in Windows, don't run in WSL). This will open a new browser windows and run all the unit tests. Make sure that the tests are successful.


### Running unit tests for the extension inside VSCode:
1. In console in rainbow_csv directory run `npm install --only=dev` - OK to run the command in WSL while launching in Windows. This will install the dependencies, including `vscode/lib/testrunner`
2. Open rainbow_csv directory in VSCode switch to "Extension Tests" mode and click run

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
1. Make sure you have webpack installed: run `npm install --only=dev` (Better to avoid running this in WSL).
   Although this would create `node_modules/` and `package-lock.json` file this is not a problem because they are excluded from final package via the `.vscodeignore` file.
2. Run vsce publish as usual. vsce will also automatically run `vscode:prepublish` / `npm run package-web` command.


### Generating documentation with showdown
In order to generate RBQL documentation use showdown - based markdown_to_html.js script from junk/rainbow_stuff
Usage: `node markdown_to_html.js ~/vscode_rainbow_csv/rbql_core/README.md out.html`


## TODO LIST
* Improve RBQL encoding handling logic when VScode encoding info API is implemented, see https://github.com/microsoft/vscode/issues/824.

* Consider keeping only one open RBQL console at any time - if another one opens automatically close the previous one.

* DEBUG: Add a huge no-op loop on startup in order to reproduce/emulate high-cpu load error from #55.

* Support virtual header for rbql_csv.

* Consider replacing the RBQL query text input with scrollable textarea - it has a drawback that on enter it will go to the next line instead running the query.

* Figure out if it is possible to convert to a web extension.

* Make the `is_web_ext` check more reliable and explicit.

* Replace callbacks with async where possible

* Store VSCode documents instead of file paths in result_set_parent_map so that the map can be used in web version. And the autodetection_stoplist also should be doc based to work in web.

* Support JOIN queries in web version.

* Get rid of typescript files and infra, but add comments explaining how you obtained the js versions of the files.

* Try to get rid of `@types/vscode` dev dependency.

* Support all commands in web version

* Use `await save_to_global_state()` everywhere.

* Use `await vscode.workspace.openTextDocument` everywhere.

* Get rid of `then` entirely

* Merge rbql_query_web and rbql_query_node

* Add comment prefix handling in RBQL, unit tests (and web_ui entry?)
