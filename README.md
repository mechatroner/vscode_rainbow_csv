# Rainbow CSV

### Main features

* Highlight columns in comma (.csv), tab (.tsv), semicolon and pipe - separated files in different colors.
* Provide info about column on mouse hover.
* Automatic consistency check for csv files (CSVLint).
* Run queries in SQL-like language
* Lightweight and dependency-free

![screenshot](https://i.imgur.com/PRFKVIN.png)

### Usage

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
For example to associate ".dat" extension with pipe-separated files and ".csv" with semicolon-separated files add the folowing lines to your VS Code config:  

```
"files.associations": {
    "*.dat": "CSV (pipe)",
    "*.csv": "CSV (semicolon)"
},
```
See the list of supported languages/separators in the table.  


#### Working with very big files

VS Code disables rainbow syntax highlighting for very big files (more than 300K lines or 20MB), but starting from VS Code version 1.23.1 there is a workaround: add `"editor.largeFileOptimizations": false` to your VS Code settings to highlight large CSV files.

#### CSVLint consistency check

The linter will check the following:  
* consistency of double quotes usage in CSV rows  
* consistency of number of fields per CSV row  

To disable automatic CSV Linting set `"rainbow_csv.enable_auto_csv_lint": false` in "Rainbow CSV" section of VS Code settings.  
To recheck a csv file click on "CSVLint" button or run `CSV Lint` command.  

### Commands:

#### RBQL
Enter RBQL - SQL-like language query editing mode.

#### CSV Lint
Run CSV check even if autocheck is disabled in VS Code configuration.

#### SetVirtualHeader
Adjust column names displayed in hover tooltips. Actual header line and file content won't be affected.  
Rainbow CSV always assumes the first row as a header, so when there is no real header in a spreadsheet, you can use this command and provide comma-separated string with column names to create a "virtual" header for more comfortable data viewing. Accepted CSV format doesn't require you to customize all of the columns - this is useful when you want to name only some small subset of available columns. Note that you must provide comma-separated string no matter what separator is actually used in your spreadsheet file. "Virtual" header is persistent and will be associated with the parent file across VSCode sessions.

### Colors customization 
You can customize Rainbow CSV colors to increase contrast. [Instructions](test/color_customization_example.md#colors-customization)

### SQL-like "RBQL" query language

Rainbow CSV has built-in RBQL query language interpreter that allows you to run SQL-like queries.  
To enter query-editing mode, execute `RBQL` command.  
RBQL is a very simple and powerful tool which would allow you to quickly and easily perform most common data-manipulation tasks.  
For more info read the [documentation](https://github.com/mechatroner/vscode_rainbow_csv/blob/master/RBQL.md#rbql)  


Screenshot of RBQL Dashboard:  
![VSCode RBQL Dashboard](https://i.imgur.com/8FfGesY.png)  


### Comparison of Rainbow CSV technology with traditional graphical column alignment

#### Advantages

* WYSIWYG  
* Familiar editing environment of your favorite text editor  
* Zero-cost abstraction: Syntax highlighting is essentially free, while graphical column alignment can be computationally expensive  
* High information density: Rainbow CSV shows more data per screen because it doesn't insert column-aligning whitespaces.
* Ability to visually associate two same-colored columns from two different windows. This is not possible with graphical column alignment  

#### Disadvantages

* Rainbow CSV technology may be less effective for CSV files with many (> 10) columns
