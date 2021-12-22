## Instructions

### Running unit tests for the extension inside VSCode:
1. In console in rainbow_csv directory run `npm install` - OK to run the command in WSL while launching in Windows. This will install the dependencies, including vscode/lib/testrunner
2. Open rainbow_csv directory in VSCode switch to "Extension Tests" mode and click run
Or alternative way to launch it (use double quotes for both Win and Linux compatibilty): code --extensionDevelopmentPath="C:\wsl_share\vscode_rainbow_csv" --wait
Running integration tests from windows cmd terminal. Example command:
code --extensionDevelopmentPath="C:\wsl_share\vscode_rainbow_csv" --extensionTestsPath="C:\wsl_share\vscode_rainbow_csv\test"
You can also run this command from wsl terminal!


### Debugging the extension:
1. Open rainbow_csv directory in VSCode  
2. Make sure you have "Extension" run mode enabled
3. Click "Run" or F5


### Running the browser version
1. Run `npm install` - OK to run in WSL
2. Run `npm run compile-web && npm run open-in-browser` - OK to run in WSL. - This should start a local server at http://localhost:3000/
3. Point your browser to http://localhost:3000/
It is possible to run this in windows cmd too, but it could be that the node_modules dir has to be deleted and installed from scratch.


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
