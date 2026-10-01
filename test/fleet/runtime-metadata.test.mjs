import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync, closeSync, copyFileSync, existsSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const MODULE_SOURCE = fileURLToPath(new URL('../../src/self-host/runtime-metadata.mjs', import.meta.url));
const CONSOLE_ASSETS = [
  'console.html', 'styles.css', 'torch-mark.svg', 'work-views.js', 'work-progress.js',
  'owner-digest.js', 'check-evidence.js', 'task-activity.js', 'operation-outcomes.js',
  'attention-projection.js', 'attention-actions.js', 'live-refresh.js', 'demo.js', 'console.js',
];
const PACKAGE_BYTES = Buffer.from('{"name":"torch-metadata-fixture","version":"0.1.0-alpha.2","type":"module"}\n');
const RELEASE_BYTES = Buffer.from('{"schema":"torch.dev/release/v1alpha1","version":"0.1.0-alpha.2","state":{"reads":["torch.dev/state/v1alpha1"],"writes":"torch.dev/state/v1alpha1","rollback_safe":true}}\n');
const PACKAGE_ALPHA3_BYTES = Buffer.from('{"name":"torch-metadata-fixture","version":"0.1.0-alpha.3","type":"module"}\n');
const RELEASE_ALPHA3_BYTES = Buffer.from('{"schema":"torch.dev/release/v1alpha1","version":"0.1.0-alpha.3","state":{"reads":["torch.dev/state/v1alpha1"],"writes":"torch.dev/state/v1alpha1","rollback_safe":true}}\n');
const PACKAGE_ALPHA4_BYTES = Buffer.from('{"name":"torch-metadata-fixture","version":"0.1.0-alpha.4","type":"module"}\n');
const RELEASE_ALPHA4_BYTES = Buffer.from('{"schema":"torch.dev/release/v1alpha1","version":"0.1.0-alpha.4","state":{"reads":["torch.dev/state/v1alpha1"],"writes":"torch.dev/state/v1alpha1","rollback_safe":true}}\n');
const CONSOLE_HTML_BYTES = Buffer.from('<main id="torch-console"></main>\n');
const STYLES_BYTES = Buffer.from(':root{color-scheme:dark}\n');
const OLD_CONSOLE_JS_BYTES = Buffer.from('window.consoleCapabilities = {};\n');
const LATER_CONSOLE_JS_BYTES = Buffer.from('window.consoleCapabilities = { blockedReason: true };\n');
const ALPHA2_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ALPHA3_COMMIT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ALPHA4_COMMIT = 'cccccccccccccccccccccccccccccccccccccccc';
const CONSOLE_AGGREGATE_PREIMAGE_RECORDS = [
  ['site/console.html', 33, '7dde07b4ced6fa4d765b386349d272471af8b02d7d1344c44acb0825e04ffd82'],
  ['site/styles.css', 25, '1f38f2b2437bde2a818f5b6bcfefa969b296d4228a05bd23091ad48f2865f7e6'],
  ['site/torch-mark.svg', 28, 'e0529597ed9e940d876ee62599cf8c59793967e560e0c1bd780b788a6958e645'],
  ['site/work-views.js', 27, 'dcf41572339c08f20def7c4c3160dfc9cfbca77ff0be814d24bbea1fb4aeb97a'],
  ['site/work-progress.js', 30, 'faa1dd5bc34e043474614ce08872dbdd127ab5128d113569782509a970f240af'],
  ['site/owner-digest.js', 29, '357fe69cf90999ecefc8c1173db5cd3a2f0e2c08c01e20dc1e5c070d067d2c9c'],
  ['site/check-evidence.js', 31, 'fe0e2552a5a4b2d871e8569ae7388dece34944e05cb7cde70e3b5c8ebe9b49e5'],
  ['site/task-activity.js', 30, '926d931fe30920b580f2d125f5e00bd2451915febfd1d84c188826548a07f2e9'],
  ['site/operation-outcomes.js', 35, 'd906a79d78684df88c9efb7c5d416514c0130f23ab7bd4cbc92f4ae1f9a07658'],
  ['site/attention-projection.js', 37, 'f9ebf53fa3b26eb155fa96397a6f3b04b929ddd4b8bfe62269f2230822954758'],
  ['site/attention-actions.js', 34, '47de3994661702d556c21cdc34de26d6fb52976c53cd16fe51a3e001154ec294'],
  ['site/live-refresh.js', 29, '797d27032a75268f884fd2b33a8c47cda6dd6be37fd59a37758085cab63f1273'],
  ['site/demo.js', 21, 'a804da821bea1d2b1e1353511dca7bcf0109cac0d7f23e54bbba7520138586e7'],
  ['site/console.js', 33, '72e85e8e7b15d04fa947acf2f76429b3313291470b917754db318275b9a5bac1'],
];

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function consoleAggregatePreimageHash(records) {
  const digest = createHash('sha256').update('torch.dev/console-assets/v1alpha1\0', 'utf8');
  for (const [path, bytes, sha256] of records) {
    digest.update(path, 'utf8').update('\0')
      .update(String(bytes), 'utf8').update('\0')
      .update(sha256, 'utf8').update('\0');
  }
  return digest.digest('hex');
}

function assertNoAbsolutePathLeak(value, fixtureRoot) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(fixtureRoot), false);
  assert.doesNotMatch(serialized, /file:\/\/|(?:^|["\s])(?:\/[^"\s]+|[A-Za-z]:[\\/][^"\s]*)/);
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function write(root, relativePath, bytes, mode = 0o644) {
  const path = join(root, relativePath);
  ensureParent(path);
  writeFileSync(path, bytes);
  chmodSync(path, mode);
  return path;
}

function makeFixture({ includeInternalLink = true } = {}) {
  const temporaryRoot = mkdtemp();
  const packageRoot = join(temporaryRoot, 'package');
  const dataHome = join(temporaryRoot, 'xdg-data');
  const home = join(temporaryRoot, 'home');
  mkdirSync(join(packageRoot, 'src', 'self-host'), { recursive: true });
  mkdirSync(join(packageRoot, 'site'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), PACKAGE_BYTES);
  writeFileSync(join(packageRoot, 'torch-release.json'), RELEASE_BYTES);
  copyFileSync(MODULE_SOURCE, join(packageRoot, 'src', 'self-host', 'runtime-metadata.mjs'));
  chmodSync(join(packageRoot, 'src', 'self-host', 'runtime-metadata.mjs'), 0o644);
  for (const name of CONSOLE_ASSETS) {
    const relativePath = `site/${name}`;
    const bytes = name === 'console.html'
      ? CONSOLE_HTML_BYTES
      : name === 'styles.css'
        ? STYLES_BYTES
        : name === 'console.js'
          ? OLD_CONSOLE_JS_BYTES
          : Buffer.from(`fixture:${relativePath}\n`, 'utf8');
    writeFileSync(join(packageRoot, relativePath), bytes);
  }
  const targetBytes = Buffer.from('TARGET_CONTENT_MUST_ONLY_APPEAR_AT_ITS_OWN_TREE_PATH\n');
  write(packageRoot, 'tools/probe.mjs', targetBytes);
  if (includeInternalLink) {
    ensureParent(join(packageRoot, 'node_modules', '.bin', 'probe'));
    symlinkSync('../../tools/probe.mjs', join(packageRoot, 'node_modules', '.bin', 'probe'));
  }
  mkdirSync(join(dataHome, 'torch', 'runtime', 'versions', '0.1.0-alpha.2'), { recursive: true });
  symlinkSync('versions/0.1.0-alpha.2', join(dataHome, 'torch', 'runtime', 'active'));
  writeFileSync(join(dataHome, 'torch', 'runtime', 'registry.json'), JSON.stringify({
    schema: 'torch.dev/version-registry/v1alpha1', activeVersion: '0.1.0-alpha.2',
    previousVersion: null, generation: 1, updatedAt: '2026-10-01T00:00:00.000Z',
  }) + '\n');
  const fixture = { temporaryRoot, packageRoot, dataHome, home, targetBytes };
  writeValidation(fixture, ALPHA2_COMMIT);
  return fixture;
}

function mkdtemp() {
  return mkdtempSync(join(tmpdir(), 'torch-runtime-metadata-'));
}

function readlinkBytes(path) {
  return readlinkSync(path, { encoding: 'buffer' });
}

function independentInventory(root) {
  const records = [];
  const visit = (directory, relativeDirectory) => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const path = join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (relativePath === '.torch-validation.json') continue;
      const stat = lstatSync(path);
      if (stat.isDirectory()) visit(path, relativePath);
      else if (stat.isFile()) records.push({ relativePath, type: 'file', mode: stat.mode & 0o777, bytes: readFileSync(path) });
      else if (stat.isSymbolicLink()) records.push({
        relativePath, type: 'symlink', mode: stat.mode & 0o777, bytes: readlinkBytes(path),
      });
      else throw new Error(`Unexpected fixture special file at ${relativePath}`);
    }
  };
  visit(root, '');
  return records;
}

function independentTreeHash(root) {
  const digest = createHash('sha256');
  const records = independentInventory(root);
  for (const record of records) {
    digest.update(record.relativePath, 'utf8').update('\0')
      .update(record.type, 'utf8').update('\0')
      .update(String(record.mode), 'utf8').update('\0')
      .update(record.bytes).update('\0');
  }
  return { digest: digest.digest('hex'), records };
}

function writeValidation(fixture, sourceCommit, version = '0.1.0-alpha.2') {
  const digest = independentTreeHash(fixture.packageRoot).digest;
  const manifest = {
    schema: 'torch.dev/candidate-validation/v1alpha1',
    version,
    digest,
    validatedAt: '2026-10-01T00:00:00.000Z',
    source: { mode: 'artifact', commit: sourceCommit },
    scenarios: ['fixture-only'],
    evidence: ['fixture-only'],
    passed: true,
  };
  writeFileSync(join(fixture.packageRoot, '.torch-validation.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function fixtureEnv(fixture, extra = {}) {
  return {
    ...process.env,
    XDG_DATA_HOME: fixture.dataHome,
    HOME: fixture.home,
    PATH: process.env.PATH,
    ...extra,
  };
}

async function importReader(fixture, extraEnv = {}) {
  const modulePath = join(fixture.packageRoot, 'src', 'self-host', 'runtime-metadata.mjs');
  const env = fixtureEnv(fixture, extraEnv);
  const previous = new Map(['XDG_DATA_HOME', 'HOME', 'PATH'].map((name) => [name, process.env[name]]));
  for (const name of previous.keys()) {
    if (Object.hasOwn(env, name)) process.env[name] = env[name];
  }
  try {
    return await import(pathToFileURL(modulePath).href);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function runReader(fixture, extraEnv = {}) {
  const api = await importReader(fixture, extraEnv);
  return { exports: Object.keys(api), value: api.readLoadedRuntimeMetadataV1() };
}

function replacePointer(fixture, version) {
  const active = join(fixture.dataHome, 'torch', 'runtime', 'active');
  rmSync(active);
  symlinkSync(`versions/${version}`, active);
}

function treeState(root) {
  const result = [];
  const visit = (directory, relativeDirectory) => {
    const entries = readdirSync(directory).sort((left, right) => left.localeCompare(right));
    for (const name of entries) {
      const path = join(directory, name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        result.push({ path: relativePath, kind: 'directory', mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs });
        visit(path, relativePath);
      } else if (stat.isSymbolicLink()) {
        result.push({ path: relativePath, kind: 'symlink', mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, target: readlinkSync(path) });
      } else if (stat.isFile()) {
        const bytes = readFileSync(path);
        result.push({ path: relativePath, kind: 'file', mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, bytes: hash(bytes) });
      } else result.push({ path: relativePath, kind: 'special', mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs });
    }
  };
  visit(root, '');
  return result;
}

function cleanup(fixture) {
  rmSync(fixture.temporaryRoot, { recursive: true, force: true });
}

test('SCN-runtime-metadata-fixed-preimages', async () => {
  assert.equal(CONSOLE_AGGREGATE_PREIMAGE_RECORDS.length, 14);
  assert.equal(CONSOLE_AGGREGATE_PREIMAGE_RECORDS.reduce((total, [, bytes]) => total + bytes, 0), 422);
  assert.equal(
    consoleAggregatePreimageHash([...CONSOLE_AGGREGATE_PREIMAGE_RECORDS].sort(([left], [right]) => left.localeCompare(right))),
    'acc9d453ee6d2256c6efb9dafff17057e3a6a501328d2eb5a6509349567587fc',
  );
  assert.equal(
    consoleAggregatePreimageHash(CONSOLE_AGGREGATE_PREIMAGE_RECORDS),
    '6bfe963481147c4c0add95e79df883c9fd7b67eab7d01556973e7a14850afe97',
  );
  assert.equal(hash(PACKAGE_BYTES), 'bb3f4716de3a74659133d53f81a040a96983084caabd1aa804e06d0925a8b488');
  assert.equal(hash(RELEASE_BYTES), '0f328f1cebc69b7cbedae7a83b5c25170d93ac2cefacbd8ea2cadc3e9e3e09be');
  assert.equal(hash(CONSOLE_HTML_BYTES), '7dde07b4ced6fa4d765b386349d272471af8b02d7d1344c44acb0825e04ffd82');
  assert.equal(hash(STYLES_BYTES), '1f38f2b2437bde2a818f5b6bcfefa969b296d4228a05bd23091ad48f2865f7e6');
  assert.equal(hash(OLD_CONSOLE_JS_BYTES), '72e85e8e7b15d04fa947acf2f76429b3313291470b917754db318275b9a5bac1');
  assert.equal(hash(LATER_CONSOLE_JS_BYTES), 'c23f1c80d89d407a99644ca9f1657184ad2f3110733e9312970ab848478b9b44');
  assert.equal(hash(PACKAGE_ALPHA3_BYTES), 'f63933fa53a8b4c1e76756a3e68fb8afdeee314b6c8d88091df9cf264024472d');
  assert.equal(hash(RELEASE_ALPHA3_BYTES), 'c3380bad909810a252f707229722316e9fabc0963a76e594b386b22394e3167f');
  assert.equal(hash(PACKAGE_ALPHA4_BYTES), '0853e676191bcf8a81ee7c2945fbe2191f7be38c72ace8aa04bd81dabc724196');
  assert.equal(hash(RELEASE_ALPHA4_BYTES), '2a82853e22b85263da96c3fecf9776bf4ac1eef191eb85505a4f9c4188ea101a');
  const names = ['a.txt', 'A.txt', '_under.txt', '.dot.txt', 'punct!.txt', 'z.txt'];
  assert.deepEqual([...names].sort((left, right) => left.localeCompare(right)), [
    '_under.txt', '.dot.txt', 'a.txt', 'A.txt', 'punct!.txt', 'z.txt',
  ]);
  const preimage = [
    ['nested/_under.txt', 'file', '420', Buffer.from('under\n')],
    ['nested/.dot.txt', 'file', '420', Buffer.from('dot\n')],
    ['nested/a.txt', 'file', '420', Buffer.from('lower\n')],
    ['nested/A.txt', 'file', '420', Buffer.from('upper\n')],
    ['nested/punct!.txt', 'file', '420', Buffer.from('bang\n')],
    ['nested/z.txt', 'file', '420', Buffer.from('zee\n')],
  ];
  const digest = createHash('sha256');
  for (const [path, type, mode, bytes] of preimage) {
    digest.update(path).update('\0').update(type).update('\0').update(mode).update('\0').update(bytes).update('\0');
  }
  assert.equal(digest.digest('hex'), '0ecc979d167c5c42c7de1055c32f227a4556af067c51f1bc750801aa11d3bcbc');
  const linkPreimage = Buffer.concat([
    Buffer.from('node_modules/.bin/probe\0symlink\0', 'utf8'),
    Buffer.from('511', 'utf8'),
    Buffer.from('\0../../tools/probe.mjs\0', 'utf8'),
  ]);
  assert.equal(hash(linkPreimage), '97bfe5f2843767ea0ba18980dd150de9e0c58858ccae862bc65757777a4e9066');

  const fixture = makeFixture();
  try {
    const expected = independentTreeHash(fixture.packageRoot);
    const declared = writeValidation(fixture, ALPHA2_COMMIT);
    assert.equal(declared.digest, expected.digest);
    const { exports, value } = await runReader(fixture);
    assert.deepEqual(exports, ['readLoadedRuntimeMetadataV1']);
    const api = await importReader(fixture);
    assert.equal(api.readLoadedRuntimeMetadataV1.length, 0);
    assert.deepEqual(value.readerModuleEvaluation.moduleIdentity, {
      relativePath: 'src/self-host/runtime-metadata.mjs',
      basis: 'reader-module-import-meta',
    });
    assert.equal(Object.hasOwn(value.readerModuleEvaluation, 'moduleUrl'), false);
    assert.equal(Object.hasOwn(value.readerModuleEvaluation, 'modulePath'), false);
    assert.equal(Object.hasOwn(value.readerModuleEvaluation, 'packageRoot'), false);
    assertNoAbsolutePathLeak(value, fixture.temporaryRoot);
    assert.equal(value.readerModuleEvaluation.candidateTree.sha256, expected.digest);
    assert.equal(value.readerModuleEvaluation.candidateTree.consistency, 'match');
    const linkRecord = expected.records.find((record) => record.relativePath === 'node_modules/.bin/probe');
    assert.equal(linkRecord.type, 'symlink');
    assert.equal(linkRecord.bytes.toString('utf8'), '../../tools/probe.mjs');
    assert.equal(hash(Buffer.concat([
      Buffer.from(`${linkRecord.relativePath}\0${linkRecord.type}\0${linkRecord.mode}\0`, 'utf8'),
      linkRecord.bytes,
      Buffer.from('\0'),
    ])), '97bfe5f2843767ea0ba18980dd150de9e0c58858ccae862bc65757777a4e9066');
    assert.equal(value.readerModuleEvaluation.candidateTree.status, 'observed');
    const expectedConsoleAssetDigests = {
      'site/console.html': '7dde07b4ced6fa4d765b386349d272471af8b02d7d1344c44acb0825e04ffd82',
      'site/styles.css': '1f38f2b2437bde2a818f5b6bcfefa969b296d4228a05bd23091ad48f2865f7e6',
      'site/torch-mark.svg': 'e0529597ed9e940d876ee62599cf8c59793967e560e0c1bd780b788a6958e645',
      'site/work-views.js': 'dcf41572339c08f20def7c4c3160dfc9cfbca77ff0be814d24bbea1fb4aeb97a',
      'site/work-progress.js': 'faa1dd5bc34e043474614ce08872dbdd127ab5128d113569782509a970f240af',
      'site/owner-digest.js': '357fe69cf90999ecefc8c1173db5cd3a2f0e2c08c01e20dc1e5c070d067d2c9c',
      'site/check-evidence.js': 'fe0e2552a5a4b2d871e8569ae7388dece34944e05cb7cde70e3b5c8ebe9b49e5',
      'site/task-activity.js': '926d931fe30920b580f2d125f5e00bd2451915febfd1d84c188826548a07f2e9',
      'site/operation-outcomes.js': 'd906a79d78684df88c9efb7c5d416514c0130f23ab7bd4cbc92f4ae1f9a07658',
      'site/attention-projection.js': 'f9ebf53fa3b26eb155fa96397a6f3b04b929ddd4b8bfe62269f2230822954758',
      'site/attention-actions.js': '47de3994661702d556c21cdc34de26d6fb52976c53cd16fe51a3e001154ec294',
      'site/live-refresh.js': '797d27032a75268f884fd2b33a8c47cda6dd6be37fd59a37758085cab63f1273',
      'site/demo.js': 'a804da821bea1d2b1e1353511dca7bcf0109cac0d7f23e54bbba7520138586e7',
      'site/console.js': '72e85e8e7b15d04fa947acf2f76429b3313291470b917754db318275b9a5bac1',
    };
    assert.deepEqual(Object.fromEntries(value.currentConsoleDisk.assets.map((asset) => [asset.path, asset.sha256])), expectedConsoleAssetDigests);
    assert.equal(value.currentConsoleDisk.aggregateSha256, 'acc9d453ee6d2256c6efb9dafff17057e3a6a501328d2eb5a6509349567587fc');
  } finally { cleanup(fixture); }
});

test('SCN-runtime-metadata-observations-not-authentication', async () => {
  const fixture = makeFixture();
  try {
    writeValidation(fixture, ALPHA2_COMMIT);
    const { value } = await runReader(fixture);
    assert.equal(value.readerModuleEvaluation.packageVersion.value, '0.1.0-alpha.2');
    assert.equal(value.readerModuleEvaluation.releaseVersion.value, '0.1.0-alpha.2');
    assert.equal(value.readerModuleEvaluation.declaredSourceCommit.value, ALPHA2_COMMIT);
    assert.equal(Object.hasOwn(value, 'blockedReason'), false);
    assert.equal(value.readerModuleEvaluation.candidateTree.consistency, 'match');
    assert.equal(value.authenticationConfidence, 'unknown');
    assert.equal(value.readerModuleEvaluation.authenticationConfidence, 'unknown');
    assert.equal(value.loadedMemoryCodeDigest, null);
    assert.equal(value.readerModuleEvaluation.loadedMemoryCodeDigest, null);
    assert.equal(value.deliveredBytesProof, null);
    assert.equal(value.currentConsoleDisk.deliveredBytesProof, null);
    assert.equal(value.nativeAuthority, null);

  } finally { cleanup(fixture); }

  const malformedRelease = makeFixture();
  try {
    writeFileSync(join(malformedRelease.packageRoot, 'torch-release.json'), '{malformed\n');
    writeValidation(malformedRelease, ALPHA2_COMMIT);
    const partial = (await runReader(malformedRelease)).value;
    assert.equal(partial.readerModuleEvaluation.packageVersion.value, '0.1.0-alpha.2');
    assert.equal(partial.readerModuleEvaluation.releaseVersion.value, null);
    assert.equal(partial.readerModuleEvaluation.declaredSourceCommit.value, ALPHA2_COMMIT);
    assert.equal(partial.readerModuleEvaluation.authenticationConfidence, 'unknown');
  } finally { cleanup(malformedRelease); }

  const oversizedMetadata = makeFixture();
  try {
    const fd = openSync(join(oversizedMetadata.packageRoot, 'torch-release.json'), 'r+');
    try { ftruncateSync(fd, 64 * 1024 + 1); } finally { closeSync(fd); }
    const result = (await runReader(oversizedMetadata)).value.readerModuleEvaluation;
    assert.equal(result.releaseVersion.status, 'unknown');
    assert.equal(result.releaseVersion.value, null);
    assert.ok(result.issues.some((entry) => entry.code === 'RUNTIME_METADATA_FILE_CAP_EXCEEDED'));
  } finally { cleanup(oversizedMetadata); }

  const laterCases = [
    { version: '0.1.0-alpha.3', packageBytes: PACKAGE_ALPHA3_BYTES, releaseBytes: RELEASE_ALPHA3_BYTES, commit: ALPHA3_COMMIT, consoleBytes: OLD_CONSOLE_JS_BYTES },
    { version: '0.1.0-alpha.4', packageBytes: PACKAGE_ALPHA4_BYTES, releaseBytes: RELEASE_ALPHA4_BYTES, commit: ALPHA4_COMMIT, consoleBytes: LATER_CONSOLE_JS_BYTES },
  ];
  for (const item of laterCases) {
    const later = makeFixture();
    try {
      writeFileSync(join(later.packageRoot, 'package.json'), item.packageBytes);
      writeFileSync(join(later.packageRoot, 'torch-release.json'), item.releaseBytes);
      writeFileSync(join(later.packageRoot, 'site', 'console.js'), item.consoleBytes);
      const validation = writeValidation(later, item.commit, item.version);
      const expected = independentTreeHash(later.packageRoot);
      assert.equal(validation.digest, expected.digest);
      const { value } = await runReader(later);
      assert.equal(value.readerModuleEvaluation.packageVersion.value, item.version);
      assert.equal(value.readerModuleEvaluation.releaseVersion.value, item.version);
      assert.equal(value.readerModuleEvaluation.declaredSourceCommit.value, item.commit);
      assert.equal(value.readerModuleEvaluation.candidateTree.sha256, expected.digest);
      assert.equal(value.readerModuleEvaluation.candidateTree.consistency, 'match');
      assert.equal(value.currentActiveRuntime.activePointer.version, '0.1.0-alpha.2');
      assert.equal(Object.hasOwn(value, 'blockedReason'), false);
      assert.equal(value.authenticationConfidence, 'unknown');
    } finally { cleanup(later); }
  }
});

test('SCN-runtime-metadata-startup-held-pointer-advance', async () => {
  const fixture = makeFixture();
  try {
    const api = await importReader(fixture);
    replacePointer(fixture, '0.1.0-alpha.3');
    writeFileSync(join(fixture.dataHome, 'torch', 'runtime', 'registry.json'), JSON.stringify({
      schema: 'torch.dev/version-registry/v1alpha1', activeVersion: '0.1.0-alpha.3',
      previousVersion: '0.1.0-alpha.2', generation: 2, updatedAt: '2026-10-01T00:01:00.000Z',
    }) + '\n');
    writeFileSync(join(fixture.packageRoot, 'site', 'console.js'), LATER_CONSOLE_JS_BYTES);
    writeValidation(fixture, ALPHA2_COMMIT);
    const value = api.readLoadedRuntimeMetadataV1();
    assert.equal(value.readerModuleEvaluation.declaredSourceCommit.value, ALPHA2_COMMIT);
    assert.equal(value.readerModuleEvaluation.packageVersion.value, '0.1.0-alpha.2');
    assert.equal(value.readerModuleEvaluation.releaseVersion.value, '0.1.0-alpha.2');
    assert.equal(Object.hasOwn(value, 'blockedReason'), false);
    assert.equal(value.readerModuleEvaluation.packageVersion.value, '0.1.0-alpha.2');
    assert.equal(value.readerModuleEvaluation.releaseVersion.value, '0.1.0-alpha.2');
    assert.equal(value.activeRuntimeAtModuleEvaluation.activePointer.version, '0.1.0-alpha.2');
    assert.equal(value.currentActiveRuntime.activePointer.version, '0.1.0-alpha.3');
    assert.equal(value.currentActiveRuntime.registry.value.generation, 2);
    assert.equal(value.relations.activePointerSinceModuleEvaluation, 'mismatch');
    assert.equal(value.relations.registryGenerationSinceModuleEvaluation, 'mismatch');
    assert.equal(value.relations.consoleDiskSinceModuleEvaluation, 'mismatch');
    const currentConsole = value.currentConsoleDisk.assets.find((asset) => asset.path === 'site/console.js');
    assert.equal(currentConsole.sha256, hash(LATER_CONSOLE_JS_BYTES));
    assert.equal(value.loadedMemoryCodeDigest, null);
    assert.equal(value.deliveredBytesProof, null);
  } finally {
    cleanup(fixture);
  }
});

test('SCN-runtime-metadata-allowlist-and-caps', async () => {
  const fixture = makeFixture();
  try {
    writeValidation(fixture, ALPHA2_COMMIT);
    writeFileSync(join(fixture.packageRoot, 'site', 'unrelated-secret.txt'), 'not routed\n');
    const { value } = await runReader(fixture);
    assert.deepEqual(value.currentConsoleDisk.assets.map((asset) => basename(asset.path)), CONSOLE_ASSETS);
    assert.equal(value.currentConsoleDisk.files, 14);
    assert.equal(value.currentConsoleDisk.assets.some((asset) => asset.path.endsWith('unrelated-secret.txt')), false);
    for (const asset of value.currentConsoleDisk.assets) {
      assert.equal(Number.isSafeInteger(asset.bytes), true);
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    }

    const oversizedUi = join(fixture.packageRoot, 'site', 'console.js');
    const fd = openSync(oversizedUi, 'r+');
    try { ftruncateSync(fd, 4 * 1024 * 1024 + 1); } finally { closeSync(fd); }
    const uiResult = (await runReader(fixture)).value;
    assert.equal(uiResult.currentConsoleDisk.status, 'refused');
    assert.equal(uiResult.currentConsoleDisk.aggregateSha256, null);
    assert.equal(uiResult.currentConsoleDisk.assets.length, 0);
    assert.equal(uiResult.currentConsoleDisk.issues[0].code, 'RUNTIME_METADATA_CONSOLE_FILE_CAP_EXCEEDED');

    const missing = join(fixture.packageRoot, 'site', 'torch-mark.svg');
    rmSync(missing);
    const missingResult = (await runReader(fixture)).value;
    assert.equal(missingResult.currentConsoleDisk.status, 'refused');
    assert.equal(missingResult.currentConsoleDisk.aggregateSha256, null);
  } finally { cleanup(fixture); }
});

test('SCN-runtime-metadata-malformed-oversize-tamper-race', async () => {
  const malformed = makeFixture();
  try {
    writeFileSync(join(malformed.packageRoot, 'package.json'), '{broken');
    writeValidation(malformed, ALPHA2_COMMIT);
    const malformedResult = (await runReader(malformed)).value;
    assert.equal(malformedResult.readerModuleEvaluation.packageVersion.value, null);
    assert.ok(malformedResult.readerModuleEvaluation.issues.some((entry) => entry.code === 'RUNTIME_METADATA_JSON_MALFORMED'));
    assert.equal(malformedResult.readerModuleEvaluation.authenticationConfidence, 'unknown');
  } finally { cleanup(malformed); }

    const oversized = makeFixture();
  try {
    const fd = openSync(join(oversized.packageRoot, 'tools', 'probe.mjs'), 'r+');
    try { ftruncateSync(fd, 64 * 1024 * 1024 + 1); } finally { closeSync(fd); }
    const result = (await runReader(oversized)).value.readerModuleEvaluation.candidateTree;
    assert.equal(result.status, 'refused');
    assert.equal(result.sha256, null);
  } finally { cleanup(oversized); }

  const oversizedTotal = makeFixture({ includeInternalLink: false });
  try {
    for (let index = 0; index < 9; index += 1) {
      const path = join(oversizedTotal.packageRoot, `large-${index}.bin`);
      const fd = openSync(path, 'w');
      try { ftruncateSync(fd, 64 * 1024 * 1024); } finally { closeSync(fd); }
    }
    const result = (await runReader(oversizedTotal)).value.readerModuleEvaluation.candidateTree;
    assert.equal(result.status, 'refused');
    assert.equal(result.sha256, null);
    assert.equal(result.bytes, null);
  } finally { cleanup(oversizedTotal); }

  const tooManyEntries = makeFixture({ includeInternalLink: false });
  try {
    for (let index = 0; index < 8193; index += 1) {
      writeFileSync(join(tooManyEntries.packageRoot, `entry-${String(index).padStart(4, '0')}`), '');
    }
    const result = (await runReader(tooManyEntries)).value.readerModuleEvaluation.candidateTree;
    assert.equal(result.status, 'refused');
    assert.equal(result.sha256, null);
    assert.ok(result.entries === null);
  } finally { cleanup(tooManyEntries); }

  const oversizedConsoleTotal = makeFixture();
  try {
    for (const name of CONSOLE_ASSETS.slice(0, 5)) {
      const path = join(oversizedConsoleTotal.packageRoot, 'site', name);
      const fd = openSync(path, 'r+');
      try { ftruncateSync(fd, 4 * 1024 * 1024); } finally { closeSync(fd); }
    }
    const result = (await runReader(oversizedConsoleTotal)).value.currentConsoleDisk;
    assert.equal(result.status, 'refused');
    assert.equal(result.aggregateSha256, null);
    assert.equal(result.assets.length, 0);
    assert.ok(result.issues.some((entry) => entry.code === 'RUNTIME_METADATA_CONSOLE_TOTAL_CAP_EXCEEDED'));
  } finally { cleanup(oversizedConsoleTotal); }

  const nofollow = makeFixture({ includeInternalLink: false });
  try {
    const original = join(nofollow.packageRoot, 'torch-release.json');
    const moved = join(nofollow.packageRoot, 'real-release.json');
    rmSync(original);
    writeFileSync(moved, RELEASE_BYTES);
    symlinkSync('real-release.json', original);
    writeValidation(nofollow, ALPHA2_COMMIT);
    const result = (await runReader(nofollow)).value.readerModuleEvaluation;
    assert.equal(result.releaseVersion.value, null);
    assert.ok(result.issues.some((entry) => entry.code === 'RUNTIME_METADATA_LINK_REFUSED'));
  } finally { cleanup(nofollow); }

  const invalidLinks = [
    ['external', '../outside', 'RUNTIME_METADATA_LINK_ESCAPE_REFUSED'],
    ['absolute', '/etc/passwd', 'RUNTIME_METADATA_LINK_ABSOLUTE_REFUSED'],
    ['dangling', 'not-present', 'RUNTIME_METADATA_LINK_DANGLING_REFUSED'],
  ];
  for (const [name, target, expectedCode] of invalidLinks) {
    const fixture = makeFixture({ includeInternalLink: false });
    try {
      symlinkSync(target, join(fixture.packageRoot, `bad-${name}`));
      writeValidation(fixture, ALPHA2_COMMIT);
      const result = (await runReader(fixture)).value.readerModuleEvaluation;
      assert.equal(result.candidateTree.status, 'unknown');
      assert.equal(result.candidateTree.sha256, null);
      assert.ok(result.issues.some((entry) => entry.code === expectedCode));
    } finally { cleanup(fixture); }
  }

  const invalidUtf8Link = makeFixture({ includeInternalLink: false });
  try {
    symlinkSync(Buffer.from([0xff]), join(invalidUtf8Link.packageRoot, 'invalid-utf8-link'));
    const result = (await runReader(invalidUtf8Link)).value.readerModuleEvaluation;
    assert.equal(result.candidateTree.status, 'unknown');
    assert.equal(result.candidateTree.sha256, null);
    assert.ok(result.issues.some((entry) => entry.code === 'RUNTIME_METADATA_LINK_UTF8_INVALID'));
  } finally { cleanup(invalidUtf8Link); }

  const longLink = makeFixture({ includeInternalLink: false });
  try {
    const linkText = `${'./'.repeat(600)}tools/probe.mjs`;
    symlinkSync(linkText, join(longLink.packageRoot, 'oversized-link'));
    writeValidation(longLink, ALPHA2_COMMIT);
    const result = (await runReader(longLink)).value.readerModuleEvaluation;
    assert.equal(result.candidateTree.status, 'unknown');
    assert.ok(result.issues.some((entry) => entry.code === 'RUNTIME_METADATA_LINK_CAP_EXCEEDED'));
  } finally { cleanup(longLink); }

  const uiLink = makeFixture();
  try {
    rmSync(join(uiLink.packageRoot, 'site', 'console.js'));
    symlinkSync('styles.css', join(uiLink.packageRoot, 'site', 'console.js'));
    writeValidation(uiLink, ALPHA2_COMMIT);
    const result = (await runReader(uiLink)).value.currentConsoleDisk;
    assert.equal(result.status, 'refused');
    assert.equal(result.aggregateSha256, null);
    assert.ok(result.issues.some((entry) => entry.code === 'RUNTIME_METADATA_LINK_REFUSED'));
  } finally { cleanup(uiLink); }

  const special = makeFixture({ includeInternalLink: false });
  const socketPath = join(special.packageRoot, 'special.sock');
  const server = await new Promise((resolvePromise, reject) => {
    const netServer = createNetServer();
    netServer.once('error', reject);
    netServer.listen(socketPath, () => resolvePromise(netServer));
  });
  try {
    const result = (await runReader(special)).value.readerModuleEvaluation.candidateTree;
    assert.equal(result.status, 'unknown');
    assert.equal(result.sha256, null);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
    cleanup(special);
  }
});

test('SCN-runtime-metadata-partial-journal', async () => {
  const fixture = makeFixture();
  try {
    writeValidation(fixture, ALPHA2_COMMIT);
    const before = treeState(join(fixture.dataHome, 'torch', 'runtime'));
    writeFileSync(join(fixture.dataHome, 'torch', 'runtime', 'activation-journal.json'), JSON.stringify({
      schema: 'torch.dev/activation-journal/v1alpha1', from: '0.1.0-alpha.1',
      to: '0.1.0-alpha.3', startedAt: '2026-10-01T00:02:00.000Z',
    }) + '\n');
    const withJournal = treeState(join(fixture.dataHome, 'torch', 'runtime'));
    const value = (await runReader(fixture)).value;
    assert.equal(value.currentActiveRuntime.journal.status, 'observed');
    assert.equal(value.currentActiveRuntime.consistency, 'mismatch');
    assert.equal(value.currentActiveRuntime.activePointer.version, '0.1.0-alpha.2');
    assert.equal(value.currentActiveRuntime.registry.value.activeVersion, '0.1.0-alpha.2');
    assert.notDeepEqual(before, withJournal);
    assert.deepEqual(treeState(join(fixture.dataHome, 'torch', 'runtime')), withJournal);

    writeFileSync(join(fixture.dataHome, 'torch', 'runtime', 'activation-journal.json'), '{partial');
    const partial = treeState(join(fixture.dataHome, 'torch', 'runtime'));
    const partialValue = (await runReader(fixture)).value.currentActiveRuntime;
    assert.equal(partialValue.journal.status, 'unknown');
    assert.ok(partialValue.issues.some((entry) => entry.code === 'RUNTIME_METADATA_JSON_MALFORMED'));
    assert.deepEqual(treeState(join(fixture.dataHome, 'torch', 'runtime')), partial);

    replacePointer(fixture, '0.1.0-alpha.3');
    const mismatched = treeState(join(fixture.dataHome, 'torch', 'runtime'));
    const pointerMismatch = (await runReader(fixture)).value.currentActiveRuntime;
    assert.equal(pointerMismatch.consistency, 'mismatch');
    assert.deepEqual(treeState(join(fixture.dataHome, 'torch', 'runtime')), mismatched);

    const active = join(fixture.dataHome, 'torch', 'runtime', 'active');
    rmSync(active);
    symlinkSync(`versions/${'x'.repeat(300)}`, active);
    const oversizedPointer = (await runReader(fixture)).value.currentActiveRuntime;
    assert.equal(oversizedPointer.activePointer.status, 'unknown');
    assert.equal(oversizedPointer.activePointer.version, null);
    assert.ok(oversizedPointer.issues.some((entry) => entry.code === 'RUNTIME_METADATA_LINK_CAP_EXCEEDED'));
  } finally { cleanup(fixture); }
});

test('SCN-runtime-metadata-invalid-active-pointer-target-privacy', async () => {
  const invalidTargets = [
    '/host/qa-private-runtime',
    '../../../../outside/qa-private-runtime',
  ];
  for (const target of invalidTargets) {
    const fixture = makeFixture();
    try {
      writeValidation(fixture, ALPHA2_COMMIT);
      const active = join(fixture.dataHome, 'torch', 'runtime', 'active');
      rmSync(active);
      symlinkSync(target, active);

      const { value } = await runReader(fixture);
      const pointer = value.currentActiveRuntime.activePointer;
      assert.equal(pointer.status, 'refused');
      assert.equal(pointer.target, null);
      assert.equal(pointer.version, null);
      assert.ok(value.currentActiveRuntime.issues.some((entry) => (
        entry.code === 'RUNTIME_METADATA_ACTIVE_POINTER_TARGET_INVALID'
      )));
      assert.equal(value.readerModuleEvaluation.packageVersion.value, '0.1.0-alpha.2');
      assert.equal(value.readerModuleEvaluation.declaredSourceCommit.value, ALPHA2_COMMIT);
      assert.equal(value.readerModuleEvaluation.candidateTree.consistency, 'match');
      assert.equal(value.currentConsoleDisk.status, 'observed');
      assert.equal(value.authenticationConfidence, 'unknown');
      assert.equal(value.loadedMemoryCodeDigest, null);
      assert.equal(value.deliveredBytesProof, null);
      assert.equal(value.nativeAuthority, null);

      const serialized = JSON.stringify(value);
      assert.equal(serialized.includes(target), false);
      assertNoAbsolutePathLeak(value, fixture.temporaryRoot);
    } finally { cleanup(fixture); }
  }
});

test('SCN-runtime-metadata-read-only-no-native-authority', async () => {
  const fixture = makeFixture();
  try {
    writeValidation(fixture, ALPHA2_COMMIT);
    const runtimePath = join(fixture.dataHome, 'torch', 'runtime');
    const databaseSentinel = join(fixture.temporaryRoot, 'state.sqlite.sentinel');
    writeFileSync(databaseSentinel, 'unchanged-sentinel');
    const beforePackage = treeState(fixture.packageRoot);
    const beforeRuntime = treeState(runtimePath);
    const beforeSentinel = hash(readFileSync(databaseSentinel));
    const moduleSource = readFileSync(MODULE_SOURCE, 'utf8');
    assert.doesNotMatch(moduleSource, /VersionService|openControlPlane|DatabaseSync|#reconcile|\.status\s*\(/);
    const { value } = await runReader(fixture);
    assert.equal(value.nativeAuthority, null);
    assert.equal(value.authenticationConfidence, 'unknown');
    assert.deepEqual(treeState(fixture.packageRoot), beforePackage);
    assert.deepEqual(treeState(runtimePath), beforeRuntime);
    assert.equal(hash(readFileSync(databaseSentinel)), beforeSentinel);
  } finally { cleanup(fixture); }
});

test('SCN-runtime-metadata-head-not-substitute', async () => {
  const fixture = makeFixture();
  try {
    write(fixture.packageRoot, '.git/HEAD', Buffer.from('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'));
    writeValidation(fixture, ALPHA2_COMMIT);
    const fakeBin = join(fixture.temporaryRoot, 'fake-bin');
    mkdirSync(fakeBin);
    const gitMarker = join(fixture.temporaryRoot, 'git-was-called');
    const fakeGit = join(fakeBin, 'git');
    writeFileSync(fakeGit, `#!/bin/sh\nprintf called > ${JSON.stringify(gitMarker)}\nexit 0\n`);
    chmodSync(fakeGit, 0o755);
    const { value } = await runReader(fixture, { PATH: `${fakeBin}:${process.env.PATH}` });
    assert.equal(value.readerModuleEvaluation.declaredSourceCommit.value, ALPHA2_COMMIT);
    assert.equal(value.readerModuleEvaluation.candidateTree.consistency, 'match');
    assert.equal(existsSync(gitMarker), false);
    assert.equal(value.authenticationConfidence, 'unknown');
  } finally { cleanup(fixture); }
});
