import { ingestEvents } from '../../src/services/memory/index.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Parse environment variables
const fallbackCadence = 'weekly';
const cadence = process.env.SCHEDULER_CADENCE || fallbackCadence;
const agentId = process.env.SCHEDULER_AGENT || `scheduler-memory-${cadence}`;
const promptPath = process.env.SCHEDULER_PROMPT_PATH || '';
const runId = process.env.SCHEDULER_RUN_ID ||
              process.env.SCHEDULER_SESSION_ID ||
              process.env.RUN_ID ||
              `session-${Date.now().toString(36)}`;

// Extract prompt intent
let promptIntent = `scheduler memory store`;
if (promptPath) {
    try {
        const promptRaw = readFileSync(promptPath, 'utf8');
        const promptLines = promptRaw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const intentLine = promptLines.find(line => line.startsWith('#') || line.toLowerCase().startsWith('goal'));
        if (intentLine) {
            promptIntent = intentLine.replace(/^#+\s*/, '');
        } else if (promptLines.length > 0) {
            promptIntent = promptLines[0];
        }
    } catch (err) {
        console.warn(`Could not read prompt file: ${promptPath}`, err.message);
    }
}

const baseTs = Date.now();
const events = [
    {
        agent_id: agentId,
        content: `Store memory event A for ${cadence} :: ${promptIntent}`,
        timestamp: baseTs,
        tags: ['scheduler', cadence, 'store'],
        metadata: {
            session_id: runId,
            source: 'scheduler-store',
            importance: 0.55,
            prompt_path: promptPath
        }
    },
    {
        agent_id: agentId,
        content: `Store memory event B for ${cadence} :: ${promptIntent}`,
        timestamp: baseTs + 1,
        tags: ['scheduler', cadence, 'store'],
        metadata: {
            session_id: runId,
            source: 'scheduler-store',
            importance: 0.55,
            prompt_path: promptPath
        }
    }
];

try {
    // 1. Ingest events
    const stored = await ingestEvents(events, { agent_id: agentId });

    // 2. Prepare artifacts
    const sessionDir = path.join('.scheduler-memory', runId);
    const latestDir = path.join('.scheduler-memory', 'latest', cadence);

    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(latestDir, { recursive: true });

    const artifact = {
        cadence,
        operation: 'store',
        runId,
        servicePath: 'src/services/memory/index.js#ingestEvents',
        inputs: {
            agentId,
            promptPath,
            promptIntent,
            events: events.length
        },
        outputs: {
            storedCount: stored.length,
            summaries: stored.map(m => m.summary)
        },
        status: 'ok'
    };

    // 3. Write artifacts
    writeFileSync(path.join(sessionDir, 'store.json'), JSON.stringify(artifact, null, 2));
    writeFileSync(path.join(sessionDir, 'store.ok'), 'MEMORY_STORED\n');
    writeFileSync(path.join(latestDir, 'store.ok'), 'MEMORY_STORED\n');

    // 4. Output success marker to stdout (for scheduler verification)
    console.log('MEMORY_STORED');
} catch (error) {
    console.error('Memory storage failed:', error);
    process.exit(1);
}
