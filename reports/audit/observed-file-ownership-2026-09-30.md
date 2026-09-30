# Install-readiness: exact observed-file ownership

The Architect previously allowed source-component and specification globs but
could reject primary claims for observed non-source files such as package metadata
and JSON schemas. Sharing those files was allowed, yet their accountable primary
owner could remain unresolved. This blocked a complete TORCH self-host roster.

Repository analysis now carries at most 1000 exact observed ownership paths plus
an explicit truncation flag. Pending proposal validation permits those paths as
ownership and evidence without inventing a directory glob or an absent file.
Truncated inventories return an ownership-review finding; source-component
coverage is not a claim of whole-repository coverage. Existing primary-collision
and pending owner-review requirements remain enforced.

`SCN-architect-file-ownership` exercises README, package manifest and JSON schema
assignment, rejects absent paths/traversal/unobserved directory globs, and uses
over 1000 real disposable files to enforce the bound and diagnostic. It is now
required by candidate acceptance. No previous test expectation was weakened.

Verification: thirteen focused design/domain scenarios PASS, focused ESLint and
diff hygiene PASS, all 38 isolated source acceptance groups PASS with test/lint/
syntax statuses zero. Receipt:
`/tmp/torch-observed-file-ownership-20260930-acceptance.json`.

This change does not approve TORCH's roster, activate a reporting graph, install
a stable launcher, start a provider or enable a timer. The accepted `03fcbdd`
candidate remains bound to its older source; qualify a new committed candidate
after this follow-up, not the old receipt against the modified tree.
