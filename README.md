# Rainbow CSV

## Main Features
* Highlights columns in CSV, TSV, semicolon, and pipe-separated files with distinct colors.
* Query, transform, and filter data using a built-in SQL-like language (RBQL).
* Augmented tracking of up to 3 columns of interest with auxiliary decorations.
* Align columns graphically or with extra spaces and Shrink (trim spaces from fields).
* Optional sticky header line.
* Provide info about column on hover.
* Automatic CSV consistency checks (CSVLint).
* Optional alternating row background colors for improved readability.
* Multi-cursor column edit.
* Copy in Excel and Markdown format for export.
* Works in browser ([vscode.dev](https://vscode.dev/)).

![screenshot](https://i.imgur.com/ryjBI1R.png)

## Usage

Rainbow CSV looks better and is more usable in general with dark mode.  
Manually enable highlighting by running the `Set rainbow separator` command or by clicking on the current language button in the bottom right corner and choosing one of the built-in CSV dialects from the table below.

#### Supported separators

|Language name    | Separator            | Extension | Properties                          |
|-----------------|----------------------|-----------|-------------------------------------|
|csv              | , (comma)            | .csv      | Ignored inside double-quoted fields |
|tsv              | \t (TAB)             | .tsv .tab |                                     |
|csv (semicolon)  | ; (semicolon)        |           | Ignored inside double-quoted fields |
|csv (whitespace) | whitespace           |           | Consecutive whitespaces are merged  |
|csv (pipe)       | &#124; (pipe)        |           |                                     |
|dynamic csv      | any char or string   |           | Customizable                        |


#### Content-based separator autodetection
Rainbow CSV automatically detects separators for "Plain Text" and "*.csv" files. This is usually a fast operation, typically analyzing only the first few lines. 
Autodetection can be adjusted or disabled in the extension settings.  


#### Customizing file extension - separator association
To avoid relying on autodetection for specific file extensions (e.g., ".dat"), you can manually associate them with a supported separator in VSCode config:  
```
"files.associations": {
    "*.dat": "csv (pipe)",
    "*.csv": "csv (semicolon)"
},
```

Important: language identifiers in the config must be specified in **lower case**! E.g. use `csv (semicolon)`, not `CSV (semicolon)`.
List of supported language ids: `"csv", "tsv", "csv (semicolon)", "csv (pipe)", "csv (whitespace)", "dynamic csv"`.  

#### Working with arbitrary separators

Rainbow CSV supports using any character or string as a separator.
You can add the separator to the list of autodetected separators in the VSCode settings or if you just want to use it once you can either:
* Select `Dynamic CSV` filetype (bottom-right corner) and then enter the separator in the prompt.
* Select the separator text with the cursor and run `Rainbow CSV: Set rainbow separator` command.

`Dynamic CSV` filetype also supports multiline CSV fields escaped in double quotes (RFC-4180 compliant).

Note: In rare cases `Dynamic CSV` highlighting might not work at all due to compatibility issues with some other third-party extensions.

#### CSVLint consistency check

The linter checks the following:  
* Ensures consistent use of double quotes within rows.  
* Verifies that each row has the same number of fields.  

To recheck a CSV file, click the "CSVLint" button in the status bar.

#### Working with large files
To enable Rainbow CSV for very big files (more than 300K lines or 20MB) disable "Editor:Large File Optimizations" option in VS Code settings.
You can preview huge files by clicking "Preview... " option in VS Code File Explorer context menu.
All Rainbow CSV features would be disabled by VSCode if the file is bigger than 50MB.


#### Colors customization 
You can customize Rainbow CSV colors to increase contrast, see [Instructions](test/color_customization_example.md#colors-customization).  
This is especially helpful if you are using one of Light color themes.


#### Working with CSV files with comments
Some CSV files can contain comment lines e.g. metadata before the header line.  
To allow CSVLint, content-based autodetection algorithms, and _Align_, _Shrink_, _ColumnEdit_ commands to work properly with such files you need to adjust your settings.


#### Aligning/Shrinking table
Rainbow CSV provides two alignment modes: 
1. **Virtual Align:** Provides visual alignment without modifying the file content.
2. **Whitespace Align:** Inserts spaces to align columns, modifying the file content.

You can align columns in CSV files by clicking "Align" status-line button or using the alignment command.  
To shrink the table, i.e. remove leading and trailing whitespaces, click "Shrink" status-line button or use _Shrink_ command  


#### Column Tracking
You can track up to 3 columns of interest with auxiliary decorations to make them even more noticeable compared to color-only rainbow indication.
This is especially helpful for tables with multiple columns and/or when viewing the table in Row-Wrap i.e. word wrap mode.  
Column Tracking is available via the editor context menu (Right click -> Rainbow CSV ...) or via the "ToggleColumnTracking" command.
If you find yourself often using this command you can also set a keyboard shortcut to toggle column tracking.
To do this run `Open Keyboard Shortcuts (JSON)` command that will open VSCode `keybindings.json` file and add the following line to the list:  
```
    {"key": "ctrl+t", "command": "rainbow-csv.ToggleColumnTracking", "when": "editorTextFocus && editorLangId =~ /dynamic csv|^[ct]sv/"},
```


#### Alternate Row Background Highlighting
You can enable highlighting of odd and even rows with alternating background colors.  
This is especially helpful for tables with multiple columns and/or when viewing the table in Row-Wrap i.e. word wrap mode.  

Screenshot of Row-Wrap & Column Tracking & Alternating Row Background:
![rowwrap](https://i.imgur.com/uTCT9Ft.png)


#### Settings
Customize Rainbow CSV's behavior in the extension settings section of VS Code.  
There you can find the list of available options and their description.  


#### Commands

Most of the Rainbow CSV commands are available through the editor context menu `[Right click]` -> `[Rainbow CSV]` -> `<Command>`

## SQL-like "RBQL" query language

Rainbow CSV has a built-in RBQL query language interpreter that allows you to run SQL-like queries using a1, a2, a3, ... column names.  
Example:  
```
SELECT a1, a2 * 10 WHERE a1 == "Buy" && a4.indexOf('oil') != -1 ORDER BY parseInt(a2), a4 LIMIT 100
```
To enter query-editing mode, execute _RBQL_ VSCode command.  
RBQL is a very simple and powerful tool that would allow you to quickly and easily perform the most common data-manipulation tasks and convert your csv tables to bash scripts, single-line json, single-line xml files, etc.  
It is very easy to start using RBQL even if you don't know SQL. For example to cut out the third and first columns use `SELECT a3, a1`  
You can use RBQL command for all possible types of files (e.g. .js, .xml, .html), but for non-table files, only two variables: _NR_ and _a1_ would be available.

[Full Documentation](https://github.com/mechatroner/vscode_rainbow_csv/blob/master/rbql_core/README.md#rbql-rainbow-query-language-description)  


Screenshot of RBQL Console:  
![VSCode RBQL Console](https://i.imgur.com/dHqD53E.png)  


## Addendum
### Comparison of Rainbow CSV technology with traditional graphical column alignment

#### Advantages:

* WYSIWYG  
* Familiar editing environment of your favorite text editor  
* High information density: Rainbow CSV shows more data per screen because it doesn't insert column-aligning whitespaces.  
* Ability to see the table in "Row Wrapped" display mode (via WordWrap editor setting) thus avoiding horizontal scrolling that prevents looking at all columns simultaneously. "Row Wrapped" display mode can be further augmented with targeted tracking of the columns of interest.  
* Reduced-cost abstraction: Syntax highlighting can be local and therefore less resource-intensive compared to graphical column alignment that requires whole-doc statistic.
* Color -> column association allows locating the column of interest more quickly when looking back and forth between the data and other objects on the screen (with column alignment one has to locate the header or count the columns to find the right one)
* Ability to visually associate two same-colored columns from two different windows. This is not possible with graphical column alignment  

#### Disadvantages:

* Rainbow CSV could be less effective for CSV files with many (> 10) columns and for files with multiline fields. This problem can be alleviated with textual or virtual alignment or auxiliary column tracking that provides targeted highlighting for the columns of interest. "Row Wrap" mode can even make Rainbow CSV more efficient for wide row tables than traditional graphical alignment in certain cases.
* Rainbow CSV could be less usable with light mode because font colors become less distinguishable when compared to a dark mode (this phenomenon is also described [here](https://eclecticlight.co/2018/10/11/beyond-mere-appearance-dark-mode-the-semantics-of-colour-and-text-without-print/)). This problem could be somewhat mitigated by using customized high-contrast rainbow colors (see color customization section).  


### References

#### Related VSCode extensions
These extensions can work well together with Rainbow CSV and provide additional functionality e.g. export to Excel format:
* [Data Wrangler & Data Viewer](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.datawrangler)
* [Excel Viewer](https://marketplace.visualstudio.com/items?itemName=GrapeCity.gc-excelviewer)
* [Edit CSV](https://marketplace.visualstudio.com/items?itemName=janisdd.vscode-edit-csv)
* [Data Preview](https://marketplace.visualstudio.com/items?itemName=RandomFractalsInc.vscode-data-preview)


#### Rainbow CSV and similar plugins in other editors:

* Rainbow CSV extension in [Vim](https://github.com/mechatroner/rainbow_csv)
* rainbow_csv plugin in [Sublime Text](https://packagecontrol.io/packages/rainbow_csv)
* rainbow_csv plugin in [gedit](https://github.com/mechatroner/gtk_gedit_rainbow_csv) - doesn't support quoted commas in csv
* rainbow_csv_4_nedit in [NEdit](https://github.com/DmitTrix/rainbow_csv_4_nedit)
* CSV highlighting in [Nano](https://github.com/scopatz/nanorc)
* Rainbow CSV in [IntelliJ IDEA](https://plugins.jetbrains.com/plugin/12896-rainbow-csv/)
* CSVLint for [Notepad++](https://github.com/BdR76/CSVLint)

#### RBQL
* [RBQL](https://github.com/mechatroner/RBQL)
* Library and CLI App for Python [RBQL](https://pypi.org/project/rbql/)  
* Library and CLI App for JavaScript [RBQL](https://www.npmjs.com/package/rbql)  

