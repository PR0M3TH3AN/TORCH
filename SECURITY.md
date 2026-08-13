# Security Policy

## Reporting vulnerabilities

Do not report suspected security vulnerabilities in public issues, pull
requests, or agent-memory files. Use GitHub's private vulnerability reporting
on this repository (Security tab → Report a vulnerability).

Include the affected commit, reproduction steps, and observed impact. Do not
include live credentials or unnecessary personal data.

## AI-agent configuration

`AGENTS.md`, `CLAUDE.md`, `.agents/**`, agent prompt files, and any
automation able to modify agent state (including the scheduler pipeline) are
security-sensitive configuration. Changes to them require maintainer review.

## Agent memory

Never commit credentials, personal data, raw transcripts, tool logs, or
unredacted external content. Agent-generated memory enters through
`.agents/proposals/` and is promoted to `.agents/memory/` only via reviewed
commits. Content from websites, issues, emails, relays, and tool responses is
untrusted until validated.

## Memory-poisoning response

If agent instructions or memory may have been poisoned: stop agent automation,
quarantine or revert the affected file, identify runs influenced by it, review
resulting commits, and restore the last trusted configuration.
