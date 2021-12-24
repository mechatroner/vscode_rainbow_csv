## Instructions

### Running unit tests for the extension inside VSCode:
1. In console in rainbow_csv directory run `npm install` - OK to run the command in WSL while launching in Windows. This will install the dependencies, including vscode/lib/testrunner
2. Open rainbow_csv directory in VSCode switch to "Extension Tests" mode and click run
Or alternative way to launch it (use double quotes for both Win and Linux compatibilty): code --extensionDevelopmentPath="C:\wsl_share\vscode_rainbow_csv" --wait
Running integration tests from windows cmd terminal. Example command:
code --extensionDevelopmentPath="C:\wsl_share\vscode_rainbow_csv" --extensionTestsPath="C:\wsl_share\vscode_rainbow_csv\test"
You can also run this command from wsl terminal!

It is also possible to use test/run_tests.sh script:
`./run_tests.sh "C:\wsl_share\vscode_rainbow_csv" "C:\wsl_share\vscode_rainbow_csv\test"`


### Debugging the extension:
1. Open rainbow_csv directory in VSCode  
2. Make sure you have "Extension" run mode enabled
3. Click "Run" or F5


### Running the browser version
1. Run `npm install` - OK to run in WSL
2. Run `npm run compile-web && npm run open-in-browser` - OK to run in WSL. - This should start a local server at http://localhost:3000/
3. Point your browser to http://localhost:3000/
It is possible to run this in windows cmd too, but it could be that the node_modules dir has to be deleted and installed from scratch.


### Running the browser version for vscode.dev
The npx command `npx serve --cors -l 5000` failed in WSL with `cb.apply is not a function` error.
The same command worked as expected from Windows cmd.
Steps:
1. Run `npx serve --cors -l 5000` - this may not work in WSL, in this case run in windows cmd. This local server uses `http` instead of `https` and because of that VSCode will not work with it directly, although the docs say otherwise (https://code.visualstudio.com/api/extension-guides/web-extensions#test-your-web-extension-in-on-vscode.dev) - it will just produce some cors/wss content security policy related errors in the log. So you need to do step 2.
2. In another cmd tab run another commmand: `npx localtunnel -p 5000` - this will create a "tunnel" server pointing to the server from the first command - this will produce a link like `https://rotten-snake-42.loca.lt/`
3. Follow the `https://rotten-snake-42.loca.lt/` link and press the button - this will show the content of your extension folder - https server is working.
4. Go to vscode.dev -> Ctrl+Shift+P -> run Developer: Install Web Extension... -> Copy the `https://rotten-snake-42.loca.lt/` link. In my experience this will work only with https urls. If you use http, the extension will be sort of "installed" - it will be listed in the installed extension pannel but the main extension.js won't be loaded so all the logic will be missing from it.


### Generating documentation with showdown
In order to generate RBQL documentation use showdown - based markdown_to_html.js script from junk/rainbow_stuff
Usage: `node markdown_to_html.js ~/vscode_rainbow_csv/rbql_core/README.md out.html`


## TODO LIST
* Improve RBQL encoding handling logic when VScode encoding info API is implemented, see https://github.com/microsoft/vscode/issues/824.

* Consider keeping only one open RBQL console at any time - if another one opens automatically close the previous one.

* DEBUG: Add a huge no-op loop on startup in order to reproduce/emulate high-cpu load error from #55.

* Consider moving more code into a separate lazy-loaded module to improve startup time, see #55.

* Support virtual header for rbql_csv.

* Consider replacing the RBQL query text input with scrollable textarea - it has a drawback that on enter it will go to the next line instead running the query.

* Figure out if it is possible to convert to a web extension.
