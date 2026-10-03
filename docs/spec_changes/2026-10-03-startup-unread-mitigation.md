# Explicit unread inbox on startup and resume

Legacy `torch_read_messages` defaults to the oldest 100 historical messages.
Observed native inboxes exceeded 100 unread messages during fleet supervision.
Launch/resume now explicitly requests the bound identity's unread inbox with a
limit of 1000 and explains chronological order, potential overflow and deliberate
acknowledgements. This uses the existing tool without changing its API contract.

This mitigation does not implement pagination, newest-first history, coherent
cross-query observation, or complete overflow detection. Those remain in the
existing unread-first inbox task. A result of 1000 is explicitly uncertain,
not a complete-inbox claim. No permissions follow from reading a message.

SCN-fleet-startup-inbox exercises the actual fresh/resume launch arguments and
registered identity-bound inbox tool against messages beyond the default page.
