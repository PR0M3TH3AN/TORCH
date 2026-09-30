"""Explicit Linux qualification only; observe, never signal, one owned group."""
import json
import os
import select
import sys
import time

root = int(sys.argv[1])
expected_start = sys.argv[2]


def record(pid):
    with open(f"/proc/{pid}/stat", encoding="utf8") as stream:
        value = stream.read()
    fields = value[value.rfind(")") + 2:].split()
    return fields


assert record(root)[19] == expected_start, "Browser PID identity changed"
assert os.getpgid(root) == root, "Browser must own an isolated process group"
handles = []
executor = int(sys.argv[3])
assert record(executor)[19] == sys.argv[4], "Harness PID identity changed"
handles.append(os.pidfd_open(executor))
observed = 0
for entry in os.scandir("/proc"):
    if not entry.name.isdigit():
        continue
    try:
        fields = record(entry.name)
        if int(fields[2]) != root or fields[0] in ("Z", "X"):
            continue
        observed += 1
        handles.append(os.pidfd_open(int(entry.name)))
    except ProcessLookupError:
        pass
    except FileNotFoundError:
        pass
assert observed > 1, "Qualification must include real browser descendants"
print(json.dumps({"event": "watching", "observed": observed}), flush=True)
deadline = time.monotonic() + 30
remaining = set(handles)
while remaining:
    ready, _, _ = select.select(list(remaining), [], [], max(0, deadline - time.monotonic()))
    assert ready, "Owned browser group did not reach terminal state"
    remaining.difference_update(ready)
for handle in handles:
    os.close(handle)
for entry in os.scandir("/proc"):
    if not entry.name.isdigit():
        continue
    try:
        fields = record(entry.name)
        assert int(fields[2]) != root or fields[0] in ("Z", "X"), "Live group member survived shutdown"
    except FileNotFoundError:
        pass
print(json.dumps({"event": "terminal", "observed": observed}), flush=True)
