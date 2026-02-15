# Prompt Safety Audit Report - 2026-02-15

## Summary
- Total Prompts: 41
- Safe Prompts: 17
- Prompts Needing Improvement: 24

## Prompts Needing Improvement

### audit-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section

**Existing Safety Features:**
- Has conditional stop logic
- Allows no-op/stopping

---
### const-refactor-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found

**Existing Safety Features:**
- Allows no-op/stopping

---
### content-audit-agent
**Issues:**
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- Has FAILURE MODES section

---
### decompose-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section

**Existing Safety Features:**
- Has conditional stop logic
- Allows no-op/stopping

---
### deps-security-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found

**Existing Safety Features:**
- Allows no-op/stopping

---
### design-system-audit-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section

**Existing Safety Features:**
- Has conditional stop logic
- Allows no-op/stopping

---
### docs-code-investigator
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section

**Existing Safety Features:**
- Has conditional stop logic
- Allows no-op/stopping

---
### innerhtml-migration-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section

**Existing Safety Features:**
- Has conditional stop logic
- Allows no-op/stopping

---
### log-fixer-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- None detected

---
### perf-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found

**Existing Safety Features:**
- Allows no-op/stopping

---
### protocol-research-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- None detected

---
### test-audit-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- None detected

---
### todo-triage-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- None detected

---
### torch-garbage-collection-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section

**Existing Safety Features:**
- Has conditional stop logic
- Allows no-op/stopping

---
### bug-reproducer-agent
**Issues:**
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- Has FAILURE MODES section

---
### feature-proposer-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- None detected

---
### perf-deepdive-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- None detected

---
### pr-review-agent
**Issues:**
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- Has FAILURE MODES section

---
### prompt-maintenance-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- None detected

---
### race-condition-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found

**Existing Safety Features:**
- Allows no-op/stopping

---
### repo-fit-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- None detected

---
### test-coverage-agent
**Issues:**
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- Has FAILURE MODES section

---
### ui-ux-agent
**Issues:**
- Missing explicit FAILURE MODES or EXIT CRITERIA section
- No clear conditional stop/exit logic found

**Existing Safety Features:**
- Allows no-op/stopping

---
### weekly-synthesis-agent
**Issues:**
- Does not clearly explicitly allow for no-op/stopping

**Existing Safety Features:**
- Has FAILURE MODES section

---
## Safe Prompts

- ci-health-agent
- docs-agent
- docs-alignment-agent
- known-issues-agent
- load-test-agent
- onboarding-audit-agent
- scheduler-update-agent
- style-agent
- changelog-agent
- dead-code-agent
- frontend-console-debug-agent
- fuzz-agent
- perf-optimization-agent
- prompt-safety-agent
- refactor-agent
- smoke-agent
- telemetry-agent
