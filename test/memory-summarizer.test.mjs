import test from 'node:test';
import assert from 'node:assert/strict';

import { loadMemoryPromptTemplates, summarizeEvents } from '../src/services/memory/summarizer.js';

const SAMPLE_EVENTS = [
  { agent_id: 'a', content: 'Deployment completed for service alpha', timestamp: 1, tags: [], metadata: {} },
  { agent_id: 'a', content: 'Contact: alice@example.com', timestamp: 2, tags: [], metadata: {} },
];

test('loadMemoryPromptTemplates loads all memory prompt templates from disk', () => {
  const templates = loadMemoryPromptTemplates();
  assert.ok(templates.summarize.includes('STRICT JSON only'));
  assert.ok(templates.condense.includes('malformed JSON'));
  assert.ok(templates.score.includes('importance'));
  assert.ok(templates.prune.includes('prune'));
});

test('summarizeEvents retries with repair prompt when first response is malformed JSON', async () => {
  const prompts = [];
  const result = await summarizeEvents(SAMPLE_EVENTS, {
    generateSummary(prompt) {
      prompts.push(prompt);
      if (prompts.length === 1) {
        return '{"summary":"partial"';
      }
      return '{"summary":"Deployment completed for service alpha [redacted:email]","importance":0.6}';
    },
  });

  assert.equal(prompts.length, 2);
  assert.equal(result.importance, 0.6);
  assert.equal(result.summary, 'Deployment completed for service alpha [redacted:email]');
});

test('summarizeEvents falls back to deterministic minimal summary with conservative importance when parsing fails twice', async () => {
  const result = await summarizeEvents(SAMPLE_EVENTS, {
    maxSummaryLength: 80,
    async generateSummary() {
      return 'not json';
    },
  });

  assert.equal(result.importance, 0.25);
  assert.match(result.summary, /Deployment completed for service alpha/);
  assert.match(result.summary, /\[redacted:email\]/);
});
