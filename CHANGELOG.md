# Rainbow CSV for Visual Studio Code Change Log

## 3.11.0
* Add user-friendly sticky header config option.
* Enable sticky header by default.
* Fix tooltip hover text bug, see [#157](https://github.com/mechatroner/vscode_rainbow_csv/issues/157).

## 3.10.0
* Fix major dynamic csv semantic highlighting bug for many non-built-in color themes [#149](https://github.com/mechatroner/vscode_rainbow_csv/issues/149)
* Fix comment lines highlighting for many non-built-in color themes
* Make dynamic csv semantic highlighting colors consistent with regular texmate grammar colors [#149](https://github.com/mechatroner/vscode_rainbow_csv/issues/149)
* RBQL: More robust python invocation order, see [#148](https://github.com/mechatroner/vscode_rainbow_csv/issues/148)
* Add debug logging option to facilitate bug reporting and triaging.

## 3.9.0
* Adjust state transition logic and improve UX for some edge cases.
* Get rid of rainbow hover text colorizing since it probably didn't work anyway.

## 3.8.0
* UI improvement: Better "CSVLint" status button by [@kostasx](https://github.com/kostasx).
* Add "Rainbow ON" conditional button.
* Update RBQL: Add `ANY_VALUE` aggregate function.
* Other minor improvements.

## 3.7.1
* Update RBQL: Fix GROUP BY queries with bare columns, see [#144](https://github.com/mechatroner/vscode_rainbow_csv/issues/144)

## 3.7.0
* Add config option to align in a new file, see [#62](https://github.com/mechatroner/vscode_rainbow_csv/issues/62).
* Other minor fixes and improvements.

## 3.6.0
* Improve CSV alignment for files containing double-width characters e.g. Chinese or Japanese characters.
* Fix performance bug in CSV alignment procedure - alignment should work noticeable faster for large files.

## 3.5.1
* Minor bugfix by lramos15@.

## 3.5.0
* Add Fixed Sticky Header support. Proposed by @BeneKenobi, see [#124](https://github.com/mechatroner/vscode_rainbow_csv/issues/124).
* Minor fixes.

## 3.4.0
* Fix minor interoperability issue with other extensions (additional autodetection check, see [#123](https://github.com/mechatroner/vscode_rainbow_csv/issues/123)).
* Update RBQL: support `AS` column alias in queries.

## 3.3.0
* Support column alignment for CSV files with multiline fields (rfc-4180).
* Remove uncommon csv dialects (such as tilde, colon and other separators) in favor of generic "dynamic csv".
* Update docs.

## 3.2.0
* UX improvements for Dynamic CSV filetype.

## 3.1.0
* Support comment lines toggle, see [#84](https://github.com/mechatroner/vscode_rainbow_csv/issues/84).
* Support double quote autoclosing and text auto-surrounding.
* Minor UX improvements
* Minor Bug fixes

## 3.0.0
* Support infinite number of arbitrary single-character and multi-character separators.
* Support multiline fields with RFC-4180 - compatible syntax highlighting.
* Support highlighting of comment lines.
* Various minor usability improvements and fixes.
* Update RBQL.

## 2.4.0
* Show cursor column info in the status line.
* UI and UX improvements.

## 2.3.0
* Improve alignment algorithm: special handling of numeric columns, see [#106](https://github.com/mechatroner/vscode_rainbow_csv/issues/106).
* Show alignment progress indicator which is very nice for large files.

## 2.2.0
* UI and UX improvements by [@anthroid](https://github.com/anthroid).

## 2.1.0
* Support RBQL and column edit mode in web version of VSCode.
* Support RBQL result set output dir customization [#101](https://github.com/mechatroner/vscode_rainbow_csv/issues/101).
* Slightly reduce startup time by moving non-critical code into a lazy-loaded module.
* Internal code refactoring.

## 2.0.0
* Enable web/browser version for vscode.dev
* RBQL: improve join table path handling.

## 1.10.0
* RBQL update: improved console UI.

## 1.9.0
* RBQL update: improved CSV header support.

## 1.8.1
* Minor RBQL update

## 1.8.0
* New command: "SetHeaderLine" by @WetDesertRock, see [#71](https://github.com/mechatroner/vscode_rainbow_csv/issues/71)
* Updated RBQL
* Added integration tests


## 1.7.0
* Updated RBQL
* Improved RBQL UI


## 1.6.0
* Updated RBQL


## 1.5.0
* Highlight column info tooltip with the same color as the column itself


## 1.4.0
* Run CSV autodetection whenever a text chunk is copied into a new untitled buffer
* Improve startup performance
* RBQL: Support column names as variables
* RBQL: Support newlines in double-quoted CSV fields
* RBQL: Change default encoding to UTF-8
* RBQL: Enable for untitled buffers
* RBQL: Improve UI/UX, add history, built-in docs


## 1.3.0
* Updated RBQL to version 0.9.0
* Restricted usage of Align/Shrink commands in files with unbalanced double quotes
* Fixed incorrect dialect name: "tilda" -> "tilde", see [#40](https://github.com/mechatroner/vscode_rainbow_csv/issues/40)
* Added an eror message when RBQL console is used with unsaved file [#41](https://github.com/mechatroner/vscode_rainbow_csv/issues/41)


## 1.2.0
* Added frequency-based fallback content-based autodetection algorithm for .csv files
* Adjusted default parameters: added '|' to the list of autodetected separators
* Fixed "Align/Shrink" button logic [#38](https://github.com/mechatroner/vscode_rainbow_csv/issues/38)
* Fixed bug: incorrect RBQL result set dialect when output dialect doesn't match input
* Improved documentation


## 1.1.0
* Special treatment of comment lines by [@larsonmars](https://github.com/larsonmars)
* RBQL encoding customization by [@mandel59](https://github.com/mandel59)
* Implemented Whitespace-separated dialect
* Linter: detect trailing whitespaces in fields [#15](https://github.com/mechatroner/vscode_rainbow_csv/issues/15)
* Added commands: remove trailing whitespaces from all fields and allign columns with trailing whitespaces
* Implemented RBQL result set copy-back command
* Improved RBQL console UI
* Customizable "Preview big CSV: head/tail" context menu options [#32](https://github.com/mechatroner/vscode_rainbow_csv/issues/32)
* Improved autodetection algorithm for files with multiple candidate separators


## 0.8.0
* Large files preview functionality implemented by [@neilsustc](https://github.com/neilsustc) see [#24](https://github.com/mechatroner/vscode_rainbow_csv/issues/24)  
* Fix single-autodetection per file limit, see [#26](https://github.com/mechatroner/vscode_rainbow_csv/issues/26)  
* Enable content-based autodetection for .csv files  
* Support tooltip message customizations, see [#12](https://github.com/mechatroner/vscode_rainbow_csv/issues/12)  
* Fix RBQL warnings  
* Various minor improvements  


## 0.7.1
* Fix: Added safety check to RBQL that would prevent accidental usage of assignment operator "=" instead of comparison "==" or "===" in JS (In Python this was not possible before the fix due to Python's own syntatic checker).  
* Added "Rainbow CSV" category to all extension commands by [@yozlet](https://github.com/yozlet) request, see [#22](https://github.com/mechatroner/vscode_rainbow_csv/issues/22)  
