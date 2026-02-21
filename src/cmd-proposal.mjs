import {
  createProposal as _createProposal,
  listProposals as _listProposals,
  applyProposal as _applyProposal,
  rejectProposal as _rejectProposal,
  getProposal as _getProposal
} from './services/governance/index.js';
import { ExitError } from './errors.mjs';
import fs from 'node:fs/promises';

export async function cmdProposal(subcommand, args = {}, deps = {}) {
  const {
    createProposal = _createProposal,
    listProposals = _listProposals,
    applyProposal = _applyProposal,
    rejectProposal = _rejectProposal,
    getProposal = _getProposal,
    readFile = fs.readFile,
    log = console.log,
    error = console.error
  } = deps;

  switch (subcommand) {
    case 'create':
      return await handleCreate(args, { createProposal, readFile, log, error });
    case 'list':
      return await handleList(args, { listProposals, log, error });
    case 'apply':
      return await handleApply(args, { applyProposal, log, error });
    case 'reject':
      return await handleReject(args, { rejectProposal, log, error });
    case 'show':
      return await handleShow(args, { getProposal, log, error });
    default:
      error(`Unknown proposal subcommand: ${subcommand}`);
      throw new ExitError(1, 'Unknown subcommand');
  }
}

async function handleCreate({ agent, target, contentFile, reason }, { createProposal, readFile, log, error }) {
  if (!agent || !target || !contentFile || !reason) {
    error('Usage: torch-lock proposal create --agent <name> --target <path> --content <file> --reason <text>');
    throw new ExitError(1, 'Missing arguments');
  }

  let newContent;
  try {
    newContent = await readFile(contentFile, 'utf8');
  } catch (_e) {
    error(`Failed to read content file: ${contentFile}`);
    throw new ExitError(1, 'File read error');
  }

  try {
    const result = await createProposal({ agent, target, newContent, reason });
    log(JSON.stringify(result, null, 2));
  } catch (e) {
    error(`Failed to create proposal: ${e.message}`);
    throw new ExitError(1, 'Proposal creation failed');
  }
}

async function handleList({ status }, { listProposals, log, error }) {
  try {
    const proposals = await listProposals();
    const filtered = status ? proposals.filter(p => p.status === status) : proposals;
    log(JSON.stringify(filtered, null, 2));
  } catch (e) {
    error(`Failed to list proposals: ${e.message}`);
    throw new ExitError(1, 'List failed');
  }
}

async function handleApply({ id }, { applyProposal, log, error }) {
  if (!id) {
    error('Usage: torch-lock proposal apply --id <proposal-id>');
    throw new ExitError(1, 'Missing id');
  }

  try {
    const result = await applyProposal(id);
    log(JSON.stringify(result, null, 2));
  } catch (e) {
    error(`Failed to apply proposal: ${e.message}`);
    throw new ExitError(1, 'Apply failed');
  }
}

async function handleReject({ id, reason }, { rejectProposal, log, error }) {
  if (!id || !reason) {
    error('Usage: torch-lock proposal reject --id <proposal-id> --reason <text>');
    throw new ExitError(1, 'Missing arguments');
  }

  try {
    const result = await rejectProposal(id, reason);
    log(JSON.stringify(result, null, 2));
  } catch (e) {
    error(`Failed to reject proposal: ${e.message}`);
    throw new ExitError(1, 'Reject failed');
  }
}

async function handleShow({ id }, { getProposal, log, error }) {
  if (!id) {
    error('Usage: torch-lock proposal show --id <proposal-id>');
    throw new ExitError(1, 'Missing id');
  }
  try {
    const proposal = await getProposal(id);
    log(JSON.stringify(proposal, null, 2));
  } catch (e) {
    error(`Failed to show proposal: ${e.message}`);
    throw new ExitError(1, 'Show failed');
  }
}
