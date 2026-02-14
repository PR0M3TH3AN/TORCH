export const FIXED_NOW = 1_700_000_000_000;

export const SYNTHETIC_EVENTS = [
  {
    agent_id: 'agent-alpha',
    content: 'Incident INC-101 resolved after restarting api service',
    timestamp: FIXED_NOW - 5_000,
    tags: ['incident', 'ops'],
    metadata: { session_id: 'session-1' },
  },
  {
    agent_id: 'agent-alpha',
    content: 'Customer email alice@example.com confirmed recovery',
    timestamp: FIXED_NOW - 3_000,
    tags: ['incident', 'customer'],
    metadata: { session_id: 'session-1' },
  },
  {
    agent_id: 'agent-alpha',
    content: 'Follow-up task created for postmortem',
    timestamp: FIXED_NOW - 2_000,
    tags: ['ops', 'task'],
    metadata: { session_id: 'session-1' },
  },
];

export const EXPECTED_SUMMARY = 'INC-101 resolved, customer contact [redacted:email], postmortem task queued';

export const EXPECTED_TAGS = ['incident', 'ops', 'customer', 'task'];

export const BASE_MEMORY_RECORD = {
  schema_version: 1,
  id: 'memory-1',
  agent_id: 'agent-alpha',
  session_id: 'session-1',
  type: 'event',
  content: 'Incident INC-101 resolved after restarting api service',
  summary: 'Incident resolved',
  tags: ['incident', 'ops'],
  importance: 0.7,
  embedding_id: null,
  created_at: FIXED_NOW - 5_000,
  last_seen: FIXED_NOW - 2_000,
  source: 'ingest',
  ttl_days: 30,
  merged_into: null,
  pinned: false,
};
