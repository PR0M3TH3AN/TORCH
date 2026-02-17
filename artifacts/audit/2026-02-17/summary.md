# Audit Report — 2026-02-17 (default branch)

**Summary**

* Date: 2026-02-17 18:04 UTC
* Node: v22.22.0 / OS: linux

**Metrics**

* Oversized files: 18 files (total excess lines: 4010)
* Total innerHTML assignments: 5

  * Top offenders:
    * dashboard/index.html — 2
    * landing/index.html — 3

* Lint failures: 13 (files: 10)

  * Example errors:
    * 23:7   warning  'CONFIRM_PUBLIC' is assigned a value but never used  no-unused-vars
    * 48:14  warning  'e' is defined but never used                        no-unused-vars
    * 25:14  warning  'e' is defined but never used  no-unused-vars
    * 62:22  warning  'e' is defined but never used  no-unused-vars
    * 29:14  warning  '_' is assigned a value but never used  no-unused-vars

**Artifacts**

* file-size-report.json
* innerhtml-report.json
* lint-report.json
* raw logs
