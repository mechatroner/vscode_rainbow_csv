# Rainbow CSV

### Main features

* Highlight columns in comma (.csv), tab (.tsv) and semicolon separated files in different colors.
* Provide info about column on mouse hover.
* Automatic consistency check for csv files (CSVLint).

![screenshot](https://i.imgur.com/PRFKVIN.png)

### Usage

If your csv, semicolon-separated or tab-separated file doesn't have .csv or .tsv extension, you can manually enable highlighting by clicking on the current language label mark in the right bottom corner and then choosing "CSV", "TSV" or "CSV (semicolon)" depending on the file content, see this [screenshot](https://stackoverflow.com/a/30776845/2898283)

#### Available separators

|language name | separator | separator can be escaped in double quoted fields | extensions |
|--------------|-----------|--------------------------------------------------|------------|
|CSV           | , (comma) | YES                                              | .csv       |
|TSV           | \t (TAB)  | NO                                              | .tsv, .tab  |
|CSV (semicolon) | ; (semicolon)  | YES                                              |   |
|CSV \| (pipe) | \| (pipe)  | NO                                              |   |


#### Working with very big files

VS Code disables rainbow syntax highlighting for very big files (more than 300K lines or 20MB), but starting from VS Code version 1.23.1 there is a workaround: add `"editor.largeFileOptimizations": false` to your VS Code settings to highlight large CSV files.

#### CSVLint consistency check

The linter will check the following:  
* consistency of double quotes usage in CSV rows  
* consistency of number of fields per CSV row  

To disable automatic CSV Linting set `"rainbow_csv.enable_auto_csv_lint": false` in "Rainbow CSV" section of VS Code settings.  
To recheck a csv file click on "CSVLint" button or run `CSV Lint` command.  

### Commands

#### CSV Lint
Run CSV check even if autocheck is disabled in VS Code configuration.

#### SetVirtualHeader
Adjust column names displayed in hover tooltips. Actual header line and file content won't be affected.  
Rainbow CSV always assumes the first row as a header, so when there is no real header in a spreadsheet, you can use this command and provide comma-separated string with column names to create a "virtual" header for more comfortable data viewing. Accepted CSV format doesn't require you to customize all of the columns - this is useful when you want to name only some small subset of available columns. Note that you must provide comma-separated string no matter what separator is actually used in your spreadsheet file. "Virtual" header is persistent and will be associated with the parent file across VSCode sessions.

### Colors customization 
You can customize Rainbow CSV highlighting colors to increase contrast.  
To do so you need to modify your VS Code settings, e.g. if you add this json [fragment](test/color_customization_example.md#colors-customization), colors will look like on the picture below:

![customized colors](https://i.imgur.com/45EJJv4.png)

#### Experimental

* Rainbow CSV has experimental RBQL mode. More info [here](https://github.com/mechatroner/vscode_rainbow_csv/blob/master/RBQL.md#rbql)
