# RBQL (RainBow Query Language) Description
RBQL is a technology which provides SQL-like language that supports _SELECT_ and _UPDATE_ queries with JavaScript expressions.  

[Official Site](https://rbql.org/)

#### Installation:

```
$ npm i rbql
```

#### Usage example:

```
$ rbql-js --query "select a1, a2 order by a1" < input.tsv
```

### Main Features
* Use JavaScript expressions inside _SELECT_, _UPDATE_, _WHERE_ and _ORDER BY_ statements
* Result set of any query immediately becomes a first-class table on it's own.
* Output entries appear in the same order as in input unless _ORDER BY_ is provided.
* Input csv/tsv spreadsheet may contain varying number of entries (but select query must be written in a way that prevents output of missing values)
* Works out of the box, no external dependencies.

### Supported SQL Keywords (Keywords are case insensitive)

* SELECT \[ TOP _N_ \] \[ DISTINCT [ COUNT ] \]
* UPDATE \[ SET \]
* WHERE
* ORDER BY ... [ DESC | ASC ]
* [ [ STRICT ] LEFT | INNER ] JOIN
* GROUP BY
* LIMIT _N_

All keywords have the same meaning as in SQL queries. You can check them [online](https://www.w3schools.com/sql/default.asp)  


#### RBQL-specific keywords, rules and limitations

* _JOIN_ statements must have the following form: _<JOIN\_KEYWORD> (/path/to/table.tsv | table_name ) ON ai == bj_  
* _UPDATE SET_ is synonym to _UPDATE_, because in RBQL there is no need to specify the source table.  
* _UPDATE_ has the same meaning as in SQL, but it also can be considered as a special type of _SELECT_ query.  
* _TOP_ and _LIMIT_ have identical meaning. Use whichever you like more.  
* _DISTINCT COUNT_ is like _DISTINCT_, but adds a new column to the "distinct" result set: number of occurrences of the entry, similar to _uniq -c_ unix command.  
*  _STRICT LEFT JOIN_ is like _LEFT JOIN_, but generates an error if any key in left table "A" doesn't have exactly one matching key in the right table "B".  

### Special variables

| Variable Name          | Variable Type | Variable Description                 |
|------------------------|---------------|--------------------------------------|
| _a1_, _a2_,..., _a{N}_   |string         | Value of i-th column                 |
| _b1_, _b2_,..., _b{N}_   |string         | Value of i-th column in join table B |
| _NR_                     |integer        | Line number (1-based)                |
| _NF_                     |integer        | Number of fields in line             |

### Aggregate functions and queries
RBQL supports the following aggregate functions, which can also be used with _GROUP BY_ keyword:  
_COUNT()_, _MIN()_, _MAX()_, _SUM()_, _AVG()_, _VARIANCE()_, _MEDIAN()_

#### Limitations
* Aggregate function are CASE SENSITIVE and must be CAPITALIZED.
* It is illegal to use aggregate functions inside JS expressions. Although you can use expressions inside aggregate functions.
  E.g. `MAX(float(a1) / 1000)` - legal; `MAX(a1) / 1000` - illegal.

### Examples of RBQL queries

* `select top 100 a1, a2 * 10, a4.length where a1 == "Buy" order by parseInt(a2)`
* `select * order by Math.random()` - random sort, this is an equivalent of bash command _sort -R_
* `select top 20 a1.length / 10, a2 where ["car", "plane", "boat"].indexOf(a2) > -1`
* `select a1.length / 10, a2 where ["car", "plane", "boat"].indexOf(a2) > -1 limit 20`
* `update set a3 = 'US' where a3.indexOf('of America') != -1`
* `select * where NR <= 10` - this is an equivalent of bash command "head -n 10", NR is 1-based')
* `select a1, a4` - this is an equivalent of bash command "cut -f 1,4"
* `select * order by parseInt(a2) desc` - this is an equivalent of bash command "sort -k2,2 -r -n"
* `select NR, *` - enumerate lines, NR is 1-based
* `select a1, b1, b2 inner join ./countries.txt on a2 == b1 order by a1, a3` - an example of join query
* `select distinct count a1.length where a2 != 'US'`
* `select MAX(a1), MIN(a1) where a2 != 'US' group by a2, a3`


### References

* rbql-js CLI App for Node.js - [npm](https://www.npmjs.com/package/rbql)  
* rbql-py CLI App in [python](https://pypi.org/project/rbql/)  
* Rainbow CSV extension with integrated RBQL in [Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=mechatroner.rainbow-csv)  
* Rainbow CSV extension with integrated RBQL in [Vim](https://github.com/mechatroner/rainbow_csv)  
* Rainbow CSV extension with integrated RBQL in [Sublime Text 3](https://packagecontrol.io/packages/rainbow_csv)  
