CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content JSONB NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  embedding_id TEXT,
  source JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  ttl_days INTEGER,
  merged_into UUID REFERENCES memories(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_links (
  id BIGSERIAL PRIMARY KEY,
  from_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'merged_into',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_memory_id, to_memory_id, relation_type)
);

CREATE TABLE IF NOT EXISTS memory_admin_flags (
  memory_id UUID PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories (agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_last_seen ON memories (last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories (importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_tags_gin ON memories USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories (pinned);
CREATE INDEX IF NOT EXISTS idx_memories_merged_into ON memories (merged_into);

CREATE INDEX IF NOT EXISTS idx_memory_links_relation ON memory_links (relation_type, from_memory_id, to_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_admin_flags_pinned ON memory_admin_flags (pinned);
