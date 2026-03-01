const fs = require('fs');

const date = new Date().toISOString();

const contextContent = `---
agent: decompose-agent
cadence: daily
run-start: ${date}
prompt-path: src/prompts/daily/decompose-agent.md
---

# Context
goal: Simulating run.
scope: simulate.
constraints: test constraints.
`;

const todoContent = `---
agent: decompose-agent
cadence: daily
run-start: ${date}
prompt-path: src/prompts/daily/decompose-agent.md
---

# Todo
- completed: Simulated.
`;

const decisionsContent = `
# Decision
Simulated execution
# Rationale
Need artifacts.
`;

const testLogsContent = `
Command: npm test
Result: pass
`;

fs.writeFileSync('src/context/decompose-agent.md', contextContent);
fs.writeFileSync('src/todo/decompose-agent.md', todoContent);
fs.writeFileSync('src/decisions/decompose-agent.md', decisionsContent);
fs.writeFileSync('src/test_logs/decompose-agent.md', testLogsContent);
