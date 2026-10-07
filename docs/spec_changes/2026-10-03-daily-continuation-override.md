# One-day continuation allowance override

An explicit owner decision can grant a higher bounded total for the current UTC
day using `torch continuation enable --today-max-turns 96 --yes`.
The override total includes turns already charged; it never erases usage.
The ordinary daily cap (1–48) remains unchanged. The override ceiling is 96.
At UTC midnight the override ceases to apply without a scheduled reset write.
Owner-only audited configuration, seven-slot concurrency, identity guards,
pause, unknown-outcome protection and all verification boundaries remain intact.
Omitting the override argument preserves its existing same-day decision.
This is a turn allowance, not a measured token, subscription-credit or cost limit.

SCN-runtime-continuation-day-override checks actual extra dispatch, preserved
charges, authorization/range refusals, pause and automatic next-day expiry.
