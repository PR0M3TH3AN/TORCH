# Scheduled stale-work review — 2026-09-30

Manager check-in actions can opt into bounded `stale_work` review. This reads
the existing authoritative task ledger and managed Git history, prioritizes
owner requests, and scopes assigned work to direct reports. Fleet Operations
also sees unassigned intake. Blocked items retain expected-waiting context;
incomplete/truncated history does not prove inactivity. Compact summaries cap
items and titles, expose counts/coverage and never include full commit histories.

Delivery writes one durable self-directed `manager-stale-work-review` prompt.
It deduplicates independently of normal check-ins and asks the manager to
refresh the read-only identity-bound MCP query before deciding. Revival,
deferral, dependency review and evidenced closure use existing mechanisms;
neither age nor commit messages grant mutation authority.

Example opt-in schedule entry for an approved project config (NOT installed):

```json
{
  "id": "daily-stale-work",
  "title": "Daily neglected-work review",
  "owner": "session-manager",
  "lifetime": "system",
  "trigger": { "type": "cron", "expression": "17 9 * * *" },
  "behavior": "coordination",
  "action": {
    "type": "manager-check-in",
    "manager_id": "session-manager",
    "stale_work": { "stale_days": 3, "max_commits": 1000, "max_items": 30 }
  },
  "required_authority": ["owner"],
  "retry": { "max_attempts": 1 },
  "failure_recipient": "session-manager",
  "source_of_truth": "Owner-approved stale-work review policy"
}
```

Cron uses host-local time. No `wake` means inbox delivery only. Optional wakes
use existing explicit owner approval, exact timer-config and runtime-budget
guards; configuring this entry does not itself install a host timer.

21 focused manager/schedule/MCP scenarios PASS, including real disposable
Git fleets, due-minute checks, approval refusal, one-message deduplication,
unchanged task bytes, unknown scan coverage and blocked-task preservation.
No host timers, provider sessions, deployments or stable installs were started.

Full isolated current-source acceptance PASS (38 groups, tests/lint/syntax),
with focused lint and diff hygiene PASS. Final receipt:
`/tmp/torch-stale-work-review-final-20260930-acceptance.json`.

Remaining: installed timer dispatch and real manager follow-through require a
separately approved live trial. A queued message is not evidence of a running AI.
