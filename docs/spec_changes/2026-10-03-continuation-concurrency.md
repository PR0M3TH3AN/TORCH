# Owner-configured continuation concurrency

The owner can configure `torch continuation enable --concurrency 7 --yes`.
The default remains three; valid settings are integers from one through seven.
An explicit tick `--limit` may tighten but never exceed the approved policy.
Each refill reads current policy; lowering capacity does not cancel active turns.
Omitted configuration fields preserve the approved daily cap and concurrency.
Configuration never resets the attempt ledger or bypasses physical identity guards.

An already-running older controller cannot hot-load this change. Replace its
timer, not its active service, and allow its native turns and controller lock to
finish before the new controller takes over. No concurrent controllers may
dispatch through the same project lock.

Scenario SCN-runtime-continuation-concurrency proves seven simultaneous pending
starts, tighter tick limits, invalid-policy refusal and preserved usage on pause.
