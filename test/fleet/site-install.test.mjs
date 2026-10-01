import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('SCN-site-install: a visitor can install the development CLI before project setup without starting agents', () => {
  const html = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(html, /href="#install">Install TORCH<\/a>/);
  assert.match(html, /id="install" aria-labelledby="install-title"/);
  assert.match(html, /Experimental source install/);
  assert.match(html, /Git, Node\.js 22 or later, and npm/);
  const install = html.match(/<code id="install-command">([\s\S]*?)<\/code>/)?.[1];
  assert.ok(install, 'installation instructions are directly visible');
  assert.match(install, /git clone --branch rewrite\/portable-agent-fleet/);
  assert.match(install, /https:\/\/github\.com\/PR0M3TH3AN\/TORCH\.git/);
  assert.match(install, /cd TORCH\nnpm ci\nnpm install --global --prefix "\$HOME\/\.local\/torch-source" \./);
  assert.match(install, /export PATH="\$HOME\/\.local\/torch-source\/bin:\$PATH"\ntorch --help/);
  assert.equal(pkg.bin.torch, './bin/torch.mjs');
  assert.doesNotMatch(install, /torch up|--force|sudo|curl.*\|/);
  assert.match(html, /do not create or start a fleet/);
  assert.match(html, /not the separately accepted pilot artifact/);
  assert.match(html, /review\.status[\s\S]*review\.reviewedBy[\s\S]*review\.reviewedAt/);
  assert.match(html, /torch install --proposal fleet-proposal\.json[\s\S]*--runtime codex --dry-run --json/);
  assert.match(html, /torch setup --dry-run --json[\s\S]*torch setup --yes --json/);
  assert.match(html, /torch up --fresh --dry-run --json/);
  assert.match(html, /Starting agents and installing host schedules are separate approvals/);
  assert.match(html, /fleet and its installed user-system schedule timer are manually paused/);
});
