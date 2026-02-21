import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cmdProposal } from '../src/cmd-proposal.mjs';
import { ExitError } from '../src/errors.mjs';

describe('cmdProposal', () => {
  const noop = () => {};

  describe('create', () => {
    it('should create a proposal successfully', async () => {
      const logs = [];
      const errors = [];
      const mockCreate = async (args) => {
        return { id: 'prop-123', status: 'open', ...args };
      };
      const mockReadFile = async () => 'file-content';

      const deps = {
        createProposal: mockCreate,
        readFile: mockReadFile,
        log: (msg) => logs.push(msg),
        error: (msg) => errors.push(msg),
      };

      const args = {
        agent: 'test-agent',
        target: 'src/foo.js',
        contentFile: 'new-content.txt',
        reason: 'fix bug',
      };

      await cmdProposal('create', args, deps);

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(errors.length, 0);
      const output = JSON.parse(logs[0]);
      assert.strictEqual(output.id, 'prop-123');
      assert.strictEqual(output.newContent, 'file-content');
      assert.strictEqual(output.agent, 'test-agent');
    });

    it('should throw if arguments are missing', async () => {
      const errors = [];
      const deps = {
        log: noop,
        error: (msg) => errors.push(msg),
      };

      await assert.rejects(
        () => cmdProposal('create', {}, deps),
        (err) => err instanceof ExitError && err.code === 1 && err.message === 'Missing arguments'
      );
      assert.ok(errors[0].includes('Usage:'));
    });

    it('should throw if file read fails', async () => {
      const errors = [];
      const mockReadFile = async () => { throw new Error('File not found'); };
      const deps = {
        readFile: mockReadFile,
        log: noop,
        error: (msg) => errors.push(msg),
      };

      const args = {
        agent: 'test-agent',
        target: 'src/foo.js',
        contentFile: 'missing.txt',
        reason: 'fix bug',
      };

      await assert.rejects(
        () => cmdProposal('create', args, deps),
        (err) => err instanceof ExitError && err.code === 1 && err.message === 'File read error'
      );
      assert.ok(errors[0].includes('Failed to read content file'));
    });

    it('should throw if createProposal fails', async () => {
      const errors = [];
      const mockCreate = async () => { throw new Error('DB error'); };
      const mockReadFile = async () => 'content';
      const deps = {
        createProposal: mockCreate,
        readFile: mockReadFile,
        log: noop,
        error: (msg) => errors.push(msg),
      };

      const args = {
        agent: 'test-agent',
        target: 'src/foo.js',
        contentFile: 'content.txt',
        reason: 'fix bug',
      };

      await assert.rejects(
        () => cmdProposal('create', args, deps),
        (err) => err instanceof ExitError && err.code === 1 && err.message === 'Proposal creation failed'
      );
      assert.ok(errors[0].includes('Failed to create proposal'));
    });
  });

  describe('list', () => {
    it('should list all proposals', async () => {
      const logs = [];
      const mockList = async () => [{ id: '1', status: 'open' }, { id: '2', status: 'closed' }];
      const deps = {
        listProposals: mockList,
        log: (msg) => logs.push(msg),
        error: noop,
      };

      await cmdProposal('list', {}, deps);

      assert.strictEqual(logs.length, 1);
      const output = JSON.parse(logs[0]);
      assert.strictEqual(output.length, 2);
    });

    it('should filter proposals by status', async () => {
      const logs = [];
      const mockList = async () => [{ id: '1', status: 'open' }, { id: '2', status: 'closed' }];
      const deps = {
        listProposals: mockList,
        log: (msg) => logs.push(msg),
        error: noop,
      };

      await cmdProposal('list', { status: 'open' }, deps);

      assert.strictEqual(logs.length, 1);
      const output = JSON.parse(logs[0]);
      assert.strictEqual(output.length, 1);
      assert.strictEqual(output[0].id, '1');
    });

    it('should handle list failure', async () => {
      const errors = [];
      const mockList = async () => { throw new Error('List error'); };
      const deps = {
        listProposals: mockList,
        log: noop,
        error: (msg) => errors.push(msg),
      };

      await assert.rejects(
        () => cmdProposal('list', {}, deps),
        (err) => err instanceof ExitError && err.code === 1 && err.message === 'List failed'
      );
      assert.ok(errors[0].includes('Failed to list proposals'));
    });
  });

  describe('apply', () => {
    it('should apply a proposal', async () => {
      const logs = [];
      const mockApply = async (id) => ({ id, status: 'applied' });
      const deps = {
        applyProposal: mockApply,
        log: (msg) => logs.push(msg),
        error: noop,
      };

      await cmdProposal('apply', { id: 'prop-1' }, deps);

      assert.strictEqual(logs.length, 1);
      const output = JSON.parse(logs[0]);
      assert.strictEqual(output.status, 'applied');
      assert.strictEqual(output.id, 'prop-1');
    });

    it('should throw if id is missing', async () => {
      const errors = [];
      const deps = {
        log: noop,
        error: (msg) => errors.push(msg),
      };

      await assert.rejects(
        () => cmdProposal('apply', {}, deps),
        (err) => err instanceof ExitError && err.code === 1 && err.message === 'Missing id'
      );
      assert.ok(errors[0].includes('Usage:'));
    });

    it('should handle apply failure', async () => {
        const errors = [];
        const mockApply = async () => { throw new Error('Apply error'); };
        const deps = {
          applyProposal: mockApply,
          log: noop,
          error: (msg) => errors.push(msg),
        };

        await assert.rejects(
          () => cmdProposal('apply', { id: 'prop-1' }, deps),
          (err) => err instanceof ExitError && err.code === 1 && err.message === 'Apply failed'
        );
        assert.ok(errors[0].includes('Failed to apply proposal'));
      });
  });

  describe('reject', () => {
    it('should reject a proposal', async () => {
      const logs = [];
      const mockReject = async (id, reason) => ({ id, status: 'rejected', reason });
      const deps = {
        rejectProposal: mockReject,
        log: (msg) => logs.push(msg),
        error: noop,
      };

      await cmdProposal('reject', { id: 'prop-1', reason: 'bad code' }, deps);

      assert.strictEqual(logs.length, 1);
      const output = JSON.parse(logs[0]);
      assert.strictEqual(output.status, 'rejected');
      assert.strictEqual(output.reason, 'bad code');
    });

    it('should throw if arguments are missing', async () => {
      const errors = [];
      const deps = {
        log: noop,
        error: (msg) => errors.push(msg),
      };

      await assert.rejects(
        () => cmdProposal('reject', { id: 'prop-1' }, deps), // missing reason
        (err) => err instanceof ExitError && err.code === 1 && err.message === 'Missing arguments'
      );
    });

    it('should handle reject failure', async () => {
        const errors = [];
        const mockReject = async () => { throw new Error('Reject error'); };
        const deps = {
          rejectProposal: mockReject,
          log: noop,
          error: (msg) => errors.push(msg),
        };

        await assert.rejects(
          () => cmdProposal('reject', { id: 'prop-1', reason: 'bad' }, deps),
          (err) => err instanceof ExitError && err.code === 1 && err.message === 'Reject failed'
        );
        assert.ok(errors[0].includes('Failed to reject proposal'));
      });
  });

  describe('show', () => {
    it('should show a proposal', async () => {
        const logs = [];
        const mockGet = async (id) => ({ id, content: 'stuff' });
        const deps = {
            getProposal: mockGet,
            log: (msg) => logs.push(msg),
            error: noop,
        };

        await cmdProposal('show', { id: 'prop-1' }, deps);

        assert.strictEqual(logs.length, 1);
        const output = JSON.parse(logs[0]);
        assert.strictEqual(output.id, 'prop-1');
        assert.strictEqual(output.content, 'stuff');
    });

    it('should throw if id is missing', async () => {
        const errors = [];
        const deps = {
            log: noop,
            error: (msg) => errors.push(msg),
        };

        await assert.rejects(
            () => cmdProposal('show', {}, deps),
            (err) => err instanceof ExitError && err.code === 1 && err.message === 'Missing id'
        );
    });

    it('should handle show failure', async () => {
        const errors = [];
        const mockGet = async () => { throw new Error('Show error'); };
        const deps = {
            getProposal: mockGet,
            log: noop,
            error: (msg) => errors.push(msg),
        };

        await assert.rejects(
            () => cmdProposal('show', { id: 'prop-1' }, deps),
            (err) => err instanceof ExitError && err.code === 1 && err.message === 'Show failed'
        );
        assert.ok(errors[0].includes('Failed to show proposal'));
    });
  });

  describe('unknown subcommand', () => {
    it('should throw ExitError for unknown subcommand', async () => {
      const errors = [];
      const deps = {
        log: noop,
        error: (msg) => errors.push(msg),
      };

      await assert.rejects(
        () => cmdProposal('foo', {}, deps),
        (err) => err instanceof ExitError && err.code === 1 && err.message === 'Unknown subcommand'
      );
      assert.ok(errors[0].includes('Unknown proposal subcommand'));
    });
  });
});
