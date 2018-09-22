## Rainbow CSV: Main features

* Highlight columns in comma (.csv), tab (.tsv), semicolon and pipe - separated files in different colors.
* Provide info about column on mouse hover.
* Automatic consistency check for csv files (CSVLint).
* Multi-cursor column edit
* Run queries in SQL-like language
* Lightweight and dependency-free

![screenshot](https://i.imgur.com/PRFKVIN.png)

## Usage

If your csv, semicolon-separated or tab-separated file doesn't have .csv or .tsv extension, you can manually enable highlighting by clicking on the current language label mark in the right bottom corner and then choosing "CSV", "TSV", "CSV (semicolon)" or "CSV (pipe)" depending on the file content, see this [screenshot](https://stackoverflow.com/a/30776845/2898283)

#### Supported separators

|language name | separator | separator can be escaped in double-quoted field | file extensions |
|--------------|-----------|--------------------------------------------------|------------|
|CSV           | , (comma) | YES                                              | .csv       |
|TSV           | \t (TAB)  | NO                                              | .tsv, .tab  |
|CSV (semicolon) | ; (semicolon)  | YES                                              | |
|CSV (pipe)    | &#124; (pipe)  | NO                                              | |


#### Customizing file extension - separator association
If you often work with spreadsheet files with one specific extension, you can associate that extension with one of the supported separators.  
For example to associate ".dat" extension with pipe-separated files and ".csv" with semicolon-separated files add the following lines to your VS Code config:  

```
"files.associations": {
    "*.dat": "csv (pipe)",
    "*.csv": "csv (semicolon)"
},
```

Important: language identifiers in config must be specified in **lower case**! e.g. `csv (semicolon)`, but not `CSV (semicolon)`.  
See the list of supported languages/separators in the table.  


#### Working with very big files

VS Code disables rainbow syntax highlighting for very big files (more than 300K lines or 20MB), but starting from VS Code version 1.23.1 there is a workaround: add `"editor.largeFileOptimizations": false` to your VS Code settings to highlight large CSV files.  
All other Rainbow CSV features would be disabled by VSCode if file is bigger than 50MB.

#### CSVLint consistency check

The linter will check the following:  
* consistency of double quotes usage in CSV rows  
* consistency of number of fields per CSV row  

To disable automatic CSV Linting set `"rainbow_csv.enable_auto_csv_lint": false` in "Rainbow CSV" section of VS Code settings.  
To recheck a csv file click on "CSVLint" button or run `CSV Lint` command.  

### Commands:

#### RBQL
Enter RBQL - SQL-like language query editing mode.

#### QueryHere
Enter RBQL query without launching RBQL Dashboard. Use only if you have experience with regular RBQL command.  

#### ColumnEditBefore (and ColumnEditAfter)
Activate multi-cursor column editing for column under the cursor. Works only for files with less than 10000 lines. For larger files you can use "UPDATE" RBQL query.

#### CSV Lint
Run CSV check even if auto-check is disabled in VS Code configuration.

#### SetVirtualHeader
Adjust column names displayed in hover tooltips. Actual header line and file content won't be affected.  
Rainbow CSV always assumes the first row as a header, so when there is no real header in a spreadsheet, you can use this command and provide comma-separated string with column names to create a "virtual" header for more comfortable data viewing. Accepted CSV format doesn't require you to customize all of the columns - this is useful when you want to name only some small subset of available columns. Note that you must provide comma-separated string no matter what separator is actually used in your spreadsheet file. "Virtual" header is persistent and will be associated with the parent file across VSCode sessions.

### Colors customization 
You can customize Rainbow CSV colors to increase contrast. [Instructions](test/color_customization_example.md#colors-customization)

## SQL-like "RBQL" query language

Rainbow CSV has built-in RBQL query language interpreter that allows you to run SQL-like queries using a1, a2, a3, ... column names.  
Example:  
```
SELECT a1, a2 * 10 WHERE a1 == "Buy" && a4.indexOf('oil') != -1 ORDER BY parseInt(a2), a4 LIMIT 100
```
To enter query-editing mode, execute `RBQL` VSCode command.  
RBQL is a very simple and powerful tool which would allow you to quickly and easily perform most common data-manipulation tasks and convert your csv tables to bash scripts, single-lines json, single-line xml files, etc.  
It is very easy to start using RBQL even if you don't know SQL. For example to cut out third and first columns use `SELECT a3, a1`  

[Full Documentation](https://github.com/mechatroner/vscode_rainbow_csv/blob/master/RBQL.md#rbql)  


Screenshot of RBQL Dashboard:  
![VSCode RBQL Dashboard](https://i.imgur.com/HsBG2Y1.png)  

#### Gotchas:
* Unlike Rainbow CSV, which always treats first line as header, RBQL is header-agnostic i.e. it never treats first line as header, so to skip over header line add `WHERE NR > 1` to your query.  
* RBQL uses JavaScript or Python backend language. This means that you need to use `==` to check for equality inside WHERE expressions.  
* If you want to use RBQL with Python backend language instead of JavaScript, make sure you have Python interpreter insatalled and added to PATH variable of your OS.  

## Other
### Comparison of Rainbow CSV technology with traditional graphical column alignment

#### Advantages:

* WYSIWYG  
* Familiar editing environment of your favorite text editor  
* Zero-cost abstraction: Syntax highlighting is essentially free, while graphical column alignment can be computationally expensive  
* High information density: Rainbow CSV shows more data per screen because it doesn't insert column-aligning whitespaces.  
* Ability to visually associate two same-colored columns from two different windows. This is not possible with graphical column alignment  

#### Disadvantages:

* Rainbow CSV may be less effective for CSV files with many (> 10) columns.  
* Rainbow CSV can't correctly handle newlines inside double-quoted CSV fields (well, theorethically it can, but only under specific conditions)  

