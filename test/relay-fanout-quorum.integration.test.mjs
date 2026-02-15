import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import { WebSocketServer } from 'ws';

import { publishLock, _resetRelayHealthState } from '../src/lock-ops.mjs';

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function createRelaySimulatorFixture(modes) {
  if (modes.length !== 3) {
    throw new Error(`Expected exactly three relays, got ${modes.length}`);
  }

  const servers = [];
  const relays = [];

  for (const mode of modes) {
    const port = await getFreePort();
    const relayUrl = `ws://127.0.0.1:${port}`;

    if (mode.type === 'connection-fail') {
      relays.push(relayUrl);
      continue;
    }

    const wss = new WebSocketServer({ host: '127.0.0.1', port });
    wss.on('connection', (socket) => {
      socket.on('message', (rawData) => {
        let payload;
        try {
          payload = JSON.parse(rawData.toString());
        } catch {
          return;
        }

        if (!Array.isArray(payload) || payload[0] !== 'EVENT') {
          return;
        }

        const event = payload[1] || {};
        if (mode.type === 'success') {
          const delayMs = mode.delayMs ?? 0;
          setTimeout(() => {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify(['OK', event.id, true, 'accepted']));
            }
          }, delayMs);
        }
      });
    });

    servers.push(wss);
    relays.push(relayUrl);
  }

  return {
    relays,
    async stop() {
      await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      })));
    },
  };
}

function parseTelemetry(lines) {
  return lines.map((line) => JSON.parse(line));
}

function makeEvent(id) {
  return {
    id,
    kind: 1,
    pubkey: 'f'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: 'relay-test',
    sig: 'e'.repeat(128),
  };
}

describe('relay fanout quorum integration', { concurrency: false }, () => {
  let fixture = null;

  beforeEach(() => {
    _resetRelayHealthState();
  });

  afterEach(async () => {
    if (fixture) {
      await fixture.stop();
      fixture = null;
    }
  });

  it('passes with required=1 when one relay succeeds and two fail', async () => {
    fixture = await createRelaySimulatorFixture([
      { type: 'success' },
      { type: 'timeout' },
      { type: 'timeout' },
    ]);

    const telemetryLogs = [];
    const result = await publishLock(fixture.relays, makeEvent('evt-required1-pass'), {
      getPublishTimeoutMsFn: () => 80,
      getMinSuccessfulRelayPublishesFn: () => 1,
      getRelayFallbacksFn: () => [],
      getMinActiveRelayPoolFn: () => 1,
      retryAttempts: 1,
      telemetryLogger: (line) => telemetryLogs.push(line),
      healthLogger: () => {},
    });

    assert.strictEqual(result.id, 'evt-required1-pass');

    const telemetry = parseTelemetry(telemetryLogs);
    const quorumSummary = telemetry.find((entry) => entry.event === 'lock_publish_quorum_met');
    assert.ok(quorumSummary);
    assert.strictEqual(quorumSummary.successCount, 1);
    assert.strictEqual(quorumSummary.requiredSuccesses, 1);
    assert.strictEqual(quorumSummary.relayAttemptedCount, 3);
  });

  it('fails with quorum error for required=1 when all relays fail', async () => {
    fixture = await createRelaySimulatorFixture([
      { type: 'timeout' },
      { type: 'timeout' },
      { type: 'timeout' },
    ]);

    const telemetryLogs = [];
    await assert.rejects(
      () => publishLock(fixture.relays, makeEvent('evt-required1-all-fail'), {
        getPublishTimeoutMsFn: () => 80,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => [],
        getMinActiveRelayPoolFn: () => 1,
        retryAttempts: 1,
        telemetryLogger: (line) => telemetryLogs.push(line),
        healthLogger: () => {},
      }),
      /error_category=relay_publish_quorum_failure/,
    );

    const telemetry = parseTelemetry(telemetryLogs);
    const relayOutcomes = telemetry.filter((entry) => entry.event === 'lock_publish_failure');
    assert.strictEqual(relayOutcomes.length, 3);
    assert.ok(relayOutcomes.every((entry) => fixture.relays.includes(entry.relayUrl)));

    const quorumSummary = telemetry.find((entry) => entry.event === 'lock_publish_quorum_failed');
    assert.ok(quorumSummary);
    assert.strictEqual(quorumSummary.successCount, 0);
    assert.strictEqual(quorumSummary.requiredSuccesses, 1);
    assert.strictEqual(quorumSummary.relayAttemptedCount, 3);
  });

  it('fails with required=2 when only one relay succeeds', async () => {
    fixture = await createRelaySimulatorFixture([
      { type: 'success' },
      { type: 'timeout' },
      { type: 'timeout' },
    ]);

    const telemetryLogs = [];
    await assert.rejects(
      () => publishLock(fixture.relays, makeEvent('evt-required2-fail'), {
        getPublishTimeoutMsFn: () => 80,
        getMinSuccessfulRelayPublishesFn: () => 2,
        getRelayFallbacksFn: () => [],
        getMinActiveRelayPoolFn: () => 1,
        retryAttempts: 1,
        telemetryLogger: (line) => telemetryLogs.push(line),
        healthLogger: () => {},
      }),
      /error_category=relay_publish_quorum_failure/,
    );

    const telemetry = parseTelemetry(telemetryLogs);
    const relayOutcomes = telemetry.filter((entry) => entry.event === 'lock_publish_failure');
    assert.strictEqual(relayOutcomes.length, 2);

    const quorumSummary = telemetry.find((entry) => entry.event === 'lock_publish_quorum_failed');
    assert.ok(quorumSummary);
    assert.strictEqual(quorumSummary.successCount, 1);
    assert.strictEqual(quorumSummary.requiredSuccesses, 2);
    assert.strictEqual(quorumSummary.relayAttemptedCount, 3);
  });

  it('passes when delayed successes reach quorum before timeout', async () => {
    fixture = await createRelaySimulatorFixture([
      { type: 'success', delayMs: 5 },
      { type: 'success', delayMs: 25 },
      { type: 'timeout' },
    ]);

    const telemetryLogs = [];
    const startedAt = Date.now();
    const result = await publishLock(fixture.relays, makeEvent('evt-delayed-quorum'), {
      getPublishTimeoutMsFn: () => 80,
      getMinSuccessfulRelayPublishesFn: () => 2,
      getRelayFallbacksFn: () => [],
      getMinActiveRelayPoolFn: () => 1,
      retryAttempts: 1,
      telemetryLogger: (line) => telemetryLogs.push(line),
      healthLogger: () => {},
    });
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(result.id, 'evt-delayed-quorum');
    assert.ok(elapsedMs < 160);

    const telemetry = parseTelemetry(telemetryLogs);
    const quorumSummary = telemetry.find((entry) => entry.event === 'lock_publish_quorum_met');
    assert.ok(quorumSummary);
    assert.strictEqual(quorumSummary.successCount, 2);
    assert.strictEqual(quorumSummary.requiredSuccesses, 2);
    assert.strictEqual(quorumSummary.relayAttemptedCount, 3);
  });
});
