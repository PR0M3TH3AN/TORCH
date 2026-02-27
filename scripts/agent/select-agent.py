#!/usr/bin/env python3
import json
import os
import sys
import glob
import re

def get_latest_log_file(log_dir):
    files = glob.glob(os.path.join(log_dir, "*.md"))
    if not files:
        return None
    return max(files, key=os.path.getmtime)

def get_previous_agent(latest_file):
    if not latest_file:
        return None

    # Try parsing frontmatter
    try:
        with open(latest_file, 'r') as f:
            content = f.read()
            # Simple frontmatter parser
            match = re.search(r'^agent:\s*(.+)$', content, re.MULTILINE)
            if match:
                return match.group(1).strip()
    except Exception:
        pass

    # Fallback to filename
    filename = os.path.basename(latest_file)
    parts = filename.split('__')
    if len(parts) >= 2:
        return parts[1]

    return None

def main():
    roster_path = 'src/prompts/roster.json'
    log_dir = 'task-logs/daily/'
    config_path = 'torch-config.json'

    # Get excluded agents from stdin (JSON)
    excluded = set()
    try:
        input_data = sys.stdin.read()

        # Skip potential npm noise/headers before the JSON object
        json_start = input_data.find('{')
        if json_start != -1:
            input_data = input_data[json_start:]
            lock_data = json.loads(input_data)
            excluded = set(lock_data.get('excluded', []))
            # Also add currently locked/completed to exclusion if not already
            excluded.update(lock_data.get('locked', []))
            excluded.update(lock_data.get('completed', []))

            # Also consider explicit "paused" list if present
            excluded.update(lock_data.get('paused', []))
    except Exception as e:
        sys.stderr.write(f"Warning: Failed to parse input JSON: {e}\n")

    with open(roster_path, 'r') as f:
        roster_data = json.load(f)
        roster = roster_data.get('daily', [])

    if not roster:
        print("Error: Empty roster")
        sys.exit(1)

    latest_file = get_latest_log_file(log_dir)
    previous_agent = get_previous_agent(latest_file)

    start_index = 0
    if previous_agent and previous_agent in roster:
         start_index = (roster.index(previous_agent) + 1) % len(roster)
    else:
        # First run fallback
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
                first_agent = config.get('scheduler', {}).get('firstPromptByCadence', {}).get('daily')
                if first_agent and first_agent in roster:
                    start_index = roster.index(first_agent)
        except Exception:
            pass

    # Round-robin selection
    for i in range(len(roster)):
        idx = (start_index + i) % len(roster)
        agent = roster[idx]
        if agent not in excluded:
            print(agent)
            return

    print("All roster tasks currently claimed by other agents")
    sys.exit(0)

if __name__ == "__main__":
    main()
