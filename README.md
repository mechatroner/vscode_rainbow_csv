# Rainbow CSV

### Main features

* Highlight columns in *.csv and *.tsv in different rainbow colors.
* Provide info about column on mouse hover.
* Automatic consistency check for csv files (CSVLint).

![screenshot](https://i.imgur.com/PRFKVIN.png)

### Usage

* If your csv or tsv file doesn't have "*.csv"("*.tsv") extension, you can manually enable highlighting by clicking on the current language label mark in the right bottom corner and then choosing "CSV", "TSV" or "CSV (semicolon)" depending on the file content, see this [screenshot](https://stackoverflow.com/a/30776845/2898283)

* To disable automatic CSV Linting set `"rainbow_csv.enable_auto_csv_lint": false` in "Rainbow CSV" section of VS Code settings.

* To recheck a csv file click on `CSVLint` button or run `CSV Lint` command.

#### CSVLint consistency check

The linter will check the following:
* consistency of double quotes usage in CSV rows
* consistency of number of fields per CSV row

### Commands

* `CSV Lint`
  Run CSV check even if autocheck is disabled in VS Code configuration.


### Colors customization 
You can customize Rainbow CSV highlighting colors to increase contrast.
To do so you need to modify your VS Code settings, e.g. if you add this json [fragment](test/color_customization_example.md), colors will look like on the picture bellow.

![customized colors](https://i.imgur.com/45EJJv4.png)

### References

* This VS Code extension is an adaptation of Vim's rainbow_csv [plugin](https://github.com/mechatroner/rainbow_csv)
