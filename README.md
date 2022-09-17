# Rainbow CSV

## Main Features
* Highlight columns in comma (.csv), tab (.tsv), semicolon and pipe - separated files in different colors
* Transform and filter tables using built-in SQL-like query language
* Provide info about column on hover
* Automatic consistency check for csv files (CSVLint)
* Multi-cursor column edit
* Align columns with spaces and Shrink (trim spaces from fields)
* Works in browser (vscode.dev) with limited functionality

![screenshot](https://i.imgur.com/6eJqeUN.png)

## Usage

If your csv, semicolon-separated or tab-separated file doesn't have .csv or .tsv extension, you can manually enable highlighting by clicking on the current language label mark in the right bottom corner and then choosing "CSV", "TSV", "CSV (semicolon)" or "CSV (pipe)" depending on the file content, see this [screenshot](https://stackoverflow.com/a/30776845/2898283)  
Another way to do this: select one separator character with mouse cursor -> right click -> "Set as Rainbow separator"  

#### Supported separators

|Language name    | Separator            | Extension | Properties                          |
|-----------------|----------------------|-----------|-------------------------------------|
|csv              | , (comma)            | .csv      | Ignored inside double-quoted fields |
|tsv              | \t (TAB)             | .tsv .tab |                                     |
|csv (semicolon)  | ; (semicolon)        |           | Ignored inside double-quoted fields |
|csv (whitespace) | whitespace           |           | Consecutive whitespaces are merged  |
|csv (pipe)       | &#124; (pipe)        |           |                                     |
|csv (...)        | ~ ^ : " = . -        |           |                                     |
|dynamic csv      | any char or string   |           |                                     |


#### Content-based separator autodetection
Rainbow CSV runs table autodetection algorithm for all "Plain Text" and "*.csv" files. In most cases this is a very cheap operation because autodetection usually stops after checking only 1 or 2 topmost lines.  
Autodetection can be disabled at the extension settings page.  
By default only comma, tab, semicolon and pipe are tried during autodetection, but you can adjust the list of candidate separators in extension settings.  


#### Customizing file extension - separator association
If you often work with csv files with one specific extension (e.g. ".dat") and you don't want to rely on the autodetection algorithm, you can associate that extension with one of the supported separators.  
For example to associate ".dat" extension with pipe-separated files and ".csv" with semicolon-separated files add the following lines to your VS Code json config:  

```
"files.associations": {
    "*.dat": "csv (pipe)",
    "*.csv": "csv (semicolon)"
},
```

Important: language identifiers in the config must be specified in **lower case**! E.g. use `csv (semicolon)`, not `CSV (semicolon)`.  
List of supported language ids: `"csv", "tsv", "csv (semicolon)", "csv (pipe)", "csv (whitespace)", "csv (tilde)", "csv (caret)", "csv (colon)", "csv (double quote)", "csv (equals)", "csv (dot)", "csv (hyphen)"`.  

#### Working with arbitrary separators

Rainbow CSV allows to use an arbitrary character or string as a separator.
You can add the separator to the list of autodetected separators in the VSCode settings or if you just want to use it once you can either:
* Select `Dynamic CSV` filetype (bottom right corner) and then enter the separator text in the popup dialog.
* Select the separator text with cursor and run `Rainbow CSV: Set separator ... ` command.

`Dynamic CSV` filetype also supports multiline CSV fields escaped in double quotes as described in RFC-4180.


#### CSVLint consistency check

The linter checks the following:  
* consistency of double quotes usage in CSV rows  
* consistency of number of fields per CSV row  

To recheck a csv file click on "CSVLint" button.


#### Working with large files
To enable Rainbow CSV for very big files (more than 300K lines or 20MB) disable "Editor:Large File Optimizations" option in VS Code settings.  
You can preview huge files by clicking "Preview... " option in VS Code File Explorer context menu.  
All Rainbow CSV features would be disabled by VSCode if file is bigger than 50MB.  


#### Working with CSV files with comments
Some CSV files can contain comment lines e.g. metadata before the header line.  
To allow CSVLint, content-based autodetection algorithms and _Align_, _Shrink_, _ColumnEdit_ commands work properly with such files you need to adjust your settings.


#### Aligning/Shrinking table
You can align columns in CSV files by clicking "Align" statusline button or use _Align_ command  
To shrink the table, i.e. remove leading and trailing whitespaces, click "Shrink" statusline button or use _Shrink_ command  


### Settings
You can customize Rainbow CSV at the extension settings section of VSCode settings.  
There you can find the list of available options and their description.  


### Commands:

#### Align, Shrink
Align columns with whitespaces or shrink them (remove leading/trailing whitespaces)

#### Set separator
Set the currently selected text (single character or multiline string) as a separator and re-highlight the file.

#### ColumnEditBefore, ColumnEditAfter, ColumnEditSelect
Activate multi-cursor column editing for column under the cursor. Works only for files with less than 10000 lines. For larger files you can use an RBQL query.  
**WARNING**: This is a dangerous mode. It is possible to accidentally corrupt table structure by incorrectly using "Backspace" or entering separator or double quote characters. Use RBQL if you are not sure.  
To remove cursor/selection from the header line use "Alt+Click" on it.  

#### SetVirtualHeader 
Input a comma-separated string with column names to adjust column names displayed in hover tooltips. Actual header line and file content won't be affected.
"Virtual" header is persistent and will be associated with the parent file across VSCode sessions.

#### SetHeaderLine 
Uses the current line to adjust column names displayed in hover tooltips. Actual header line and file content won't be affected.
This is a "Virtual" header and will be persistent and will be associated with the parent file across VSCode sessions.

#### RBQL
Enter RBQL - SQL-like language query editing mode.

#### SetJoinTableName
Set a custom name for the current file so you can use it instead of the file path in RBQL JOIN queries


### Colors customization 
You can customize Rainbow CSV colors to increase contrast. [Instructions](test/color_customization_example.md#colors-customization)

## SQL-like "RBQL" query language

Rainbow CSV has built-in RBQL query language interpreter that allows you to run SQL-like queries using a1, a2, a3, ... column names.  
Example:  
```
SELECT a1, a2 * 10 WHERE a1 == "Buy" && a4.indexOf('oil') != -1 ORDER BY parseInt(a2), a4 LIMIT 100
```
To enter query-editing mode, execute _RBQL_ VSCode command.  
RBQL is a very simple and powerful tool which would allow you to quickly and easily perform most common data-manipulation tasks and convert your csv tables to bash scripts, single-lines json, single-line xml files, etc.  
It is very easy to start using RBQL even if you don't know SQL. For example to cut out third and first columns use `SELECT a3, a1`  
You can use RBQL command for all possible types of files (e.g. .js, .xml, .html), but for non-table files only two variables: _NR_ and _a1_ would be available.

[Full Documentation](https://github.com/mechatroner/vscode_rainbow_csv/blob/master/rbql_core/README.md#rbql-rainbow-query-language-description)  


Screenshot of RBQL Console:  
![VSCode RBQL Console](https://i.imgur.com/cQGJ8Vq.png)  


## Other
### Comparison of Rainbow CSV technology with traditional graphical column alignment

#### Advantages:

* WYSIWYG  
* Familiar editing environment of your favorite text editor  
* Zero-cost abstraction: Syntax highlighting is essentially free, while graphical column alignment can be computationally expensive  
* High information density: Rainbow CSV shows more data per screen because it doesn't insert column-aligning whitespaces.  
* Color -> column association allows to locate the column of interest more quickly when looking back and forth between the data and other objects on the screen (with column alignment one has to locate the header or count the columns to find the right one)
* Ability to visually associate two same-colored columns from two different windows. This is not possible with graphical column alignment  

#### Disadvantages:

* Rainbow CSV may be less effective for CSV files with many (> 10) columns and for files with multiline fields, although textual alignment can significantly improve the situation.  


### References

#### Related VSCode extensions
These extensions can work well together with Rainbow CSV and provide additional functionality e.g. export to Excel format:
* [Excel Viewer](https://marketplace.visualstudio.com/items?itemName=GrapeCity.gc-excelviewer)
* [Edit CSV](https://marketplace.visualstudio.com/items?itemName=janisdd.vscode-edit-csv)
* [Data Preview](https://marketplace.visualstudio.com/items?itemName=RandomFractalsInc.vscode-data-preview)


#### Rainbow CSV and similar plugins in other editors:

* Rainbow CSV extension in [Vim](https://github.com/mechatroner/rainbow_csv)
* rainbow-csv package in [Atom](https://atom.io/packages/rainbow-csv)
* rainbow_csv plugin in [Sublime Text](https://packagecontrol.io/packages/rainbow_csv)
* rainbow_csv plugin in [gedit](https://github.com/mechatroner/gtk_gedit_rainbow_csv) - doesn't support quoted commas in csv
* rainbow_csv_4_nedit in [NEdit](https://github.com/DmitTrix/rainbow_csv_4_nedit)
* CSV highlighting in [Nano](https://github.com/scopatz/nanorc)
* Rainbow CSV in [IntelliJ IDEA](https://plugins.jetbrains.com/plugin/12896-rainbow-csv/)

#### RBQL
* [RBQL](https://github.com/mechatroner/RBQL)
* Library and CLI App for Python [RBQL](https://pypi.org/project/rbql/)  
* Library and CLI App for JavaScript [RBQL](https://www.npmjs.com/package/rbql)  

