import os
import re

audit_file = "artifacts/prompt-safety-audit.md"

with open(audit_file, "r") as f:
    audit_data = f.read()

agents = {}
blocks = audit_data.split("### ")
for block in blocks[1:]:
    if "## Safe Prompts" in block:
        block = block.split("## Safe Prompts")[0]
        
    lines = block.strip().split('\n')
    if not lines: continue
    agent_name = lines[0].strip()
    if not agent_name: continue
    
    try:
        issues_str = block.split("**Issues:**")[1].split("**Existing Safety Features:**")[0]
        issues = [line.strip("- ").strip() for line in issues_str.strip().split('\n') if line.strip().startswith("- ")]
        agents[agent_name] = issues
    except:
        pass

def fix_agent(agent, issues):
    path = None
    for folder in ["daily", "weekly"]:
        p = f"src/prompts/{folder}/{agent}.md"
        if os.path.exists(p):
            path = p
            break
            
    if not path:
        print(f"Could not find {agent}")
        return
        
    with open(path, "r") as f:
        content = f.read()

    missing_failure = any("Missing explicit FAILURE MODES" in i for i in issues)
    missing_noop = any("no-op/stopping" in i for i in issues)
    
    if missing_failure and "FAILURE MODES" not in content:
        failure_text = "\n\nFAILURE MODES\n- If preconditions are not met, stop.\n- If no changes are needed, do nothing.\n- If specific resources (files, URLs) are unavailable, log the error and skip.\n"
        if "OUTPUTS\n" in content:
            content = content.replace("OUTPUTS\n", failure_text + "\nOUTPUTS\n")
        elif "OUTPUTS" in content:
            content = content.replace("OUTPUTS", failure_text + "\nOUTPUTS")
        else:
            content += failure_text
            
    if missing_noop:
        noop_text = "If no work is required, exit without making changes."
        if "WORKFLOW" in content:
            content = re.sub(r'(WORKFLOW.*?\n)', r'\1\n' + noop_text + '\n', content, count=1)
        elif "MISSION" in content:
            content = re.sub(r'(MISSION.*?\n)', r'\1\n' + noop_text + '\n', content, count=1)
        else:
            content = noop_text + "\n\n" + content
            
    with open(path, "w") as f:
        f.write(content)
    print(f"Fixed {agent}")

for agent, issues in agents.items():
    fix_agent(agent, issues)
