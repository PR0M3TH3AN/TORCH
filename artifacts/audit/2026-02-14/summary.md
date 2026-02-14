# Audit Report — 2026-02-14 (default branch)

**Summary**

* Date: 2026-02-14
* Agent: audit-agent
* Status: **FAILED**

**Failure Reason**

The required audit scripts are missing from the repository.

* `scripts/check-file-size.mjs`: MODULE_NOT_FOUND
* `scripts/check-innerhtml.mjs`: MODULE_NOT_FOUND
* `npm run lint`: Missing script

**Metrics**

* Grandfathered oversized files: N/A
* New oversized files: N/A
* Total innerHTML assignments: N/A
* Lint failures: N/A

**Artifacts**

* [raw-check-file-size.log](./raw-check-file-size.log)
* [raw-check-innerhtml.log](./raw-check-innerhtml.log)
* [raw-lint.log](./raw-lint.log)
