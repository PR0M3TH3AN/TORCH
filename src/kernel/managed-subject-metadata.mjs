import { TorchError } from './errors.mjs';

export const MANAGED_SUBJECT_METADATA_PROTOCOL_VERSION = 1;
export const MANAGED_SUBJECT_METADATA_MAX_FRAME_BYTES = 1024 * 1024;

const SCHEMA = 'torch.dev/managed-subject-metadata/v1alpha1';
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
const FRAME_LABELS = Object.freeze([
  'schema', 'protocol-version',
  'E-module-id', 'E-interface-version', 'E-byte-length', 'E-sha256',
  'S-project-id', 'S-product-commit', 'S-clean-tree-digest', 'S-storage-schema-version', 'S-storage-schema-digest',
  'A-module-id', 'A-interface-version', 'A-byte-length', 'A-sha256',
  'A-control-plane-schema-version', 'A-compatible-storage-schema-version', 'A-compatible-storage-schema-digest',
]);

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function exactObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`, 'MANAGED_SUBJECT_METADATA_INVALID');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains an unsupported field`, 'MANAGED_SUBJECT_METADATA_INVALID', { field: key });
  }
}

function boundedString(value, field, pattern = null) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 256 || (pattern && !pattern.test(value))) {
    fail(`${field} is invalid`, 'MANAGED_SUBJECT_METADATA_INVALID', { field });
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${field} must be a positive safe integer`, 'MANAGED_SUBJECT_METADATA_INVALID', { field });
  }
  return value;
}

function byteLength(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a non-negative safe integer`, 'MANAGED_SUBJECT_METADATA_INVALID', { field });
  }
  return value;
}

function freezeMetadata(metadata) {
  return Object.freeze({
    schema: metadata.schema,
    protocolVersion: metadata.protocolVersion,
    engine: Object.freeze({ ...metadata.engine }),
    subject: Object.freeze({ ...metadata.subject }),
    adapter: Object.freeze({ ...metadata.adapter }),
  });
}

function frame(label, value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from(`${label}:${bytes.length}\n`, 'ascii'), bytes, Buffer.from('\n', 'ascii')]);
}

function decodeUtf8(bytes, field) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`${field} is not valid UTF-8`, 'MANAGED_SUBJECT_METADATA_INVALID', { field });
  }
}

function capturedBytes(value) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) {
    fail('Metadata must be captured bytes', 'MANAGED_SUBJECT_METADATA_INVALID');
  }
  if (!value.byteLength || value.byteLength > MANAGED_SUBJECT_METADATA_MAX_FRAME_BYTES) {
    fail('Metadata frame exceeds the v1 bound', 'MANAGED_SUBJECT_METADATA_FRAME_TOO_LARGE');
  }
  return Buffer.from(value);
}

function parseFrames(bytes) {
  const fields = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const headerEnd = bytes.indexOf(0x0a, offset);
    if (headerEnd === -1) fail('Metadata frame header is incomplete', 'MANAGED_SUBJECT_METADATA_INVALID');
    const header = bytes.subarray(offset, headerEnd).toString('ascii');
    const match = /^([A-Za-z0-9-]+):([0-9]+)$/.exec(header);
    if (!match || (match[2].length > 1 && match[2].startsWith('0'))) {
      fail('Metadata frame header is malformed', 'MANAGED_SUBJECT_METADATA_INVALID');
    }
    const [, label, lengthText] = match;
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length > MANAGED_SUBJECT_METADATA_MAX_FRAME_BYTES) {
      fail('Metadata frame length is invalid', 'MANAGED_SUBJECT_METADATA_INVALID');
    }
    const valueStart = headerEnd + 1;
    const valueEnd = valueStart + length;
    if (valueEnd >= bytes.length || bytes[valueEnd] !== 0x0a || fields.has(label)) {
      fail('Metadata frame body is malformed', 'MANAGED_SUBJECT_METADATA_INVALID');
    }
    fields.set(label, decodeUtf8(bytes.subarray(valueStart, valueEnd), label));
    offset = valueEnd + 1;
  }
  if (fields.size !== FRAME_LABELS.length || FRAME_LABELS.some((label) => !fields.has(label))) {
    fail('Metadata frame fields are unsupported or incomplete', 'MANAGED_SUBJECT_METADATA_INVALID');
  }
  return fields;
}

/** Validates only captured E/S/A observations. It intentionally has no authority or filesystem inputs. */
export function validateManagedSubjectMetadataV1(value) {
  exactObject(value, new Set(['schema', 'protocolVersion', 'engine', 'subject', 'adapter']), 'Metadata');
  if (value.schema !== SCHEMA || value.protocolVersion !== MANAGED_SUBJECT_METADATA_PROTOCOL_VERSION) {
    fail('Metadata protocol is unsupported', 'MANAGED_SUBJECT_METADATA_INVALID');
  }
  exactObject(value.engine, new Set(['moduleId', 'interfaceVersion', 'byteLength', 'sha256']), 'Engine observation');
  exactObject(value.subject, new Set(['projectId', 'productCommit', 'cleanTreeDigest', 'storageSchemaVersion', 'storageSchemaDigest']), 'Subject observation');
  exactObject(value.adapter, new Set([
    'moduleId', 'interfaceVersion', 'byteLength', 'sha256', 'controlPlaneSchemaVersion',
    'compatibleStorageSchemaVersion', 'compatibleStorageSchemaDigest',
  ]), 'Adapter observation');
  const metadata = {
    schema: SCHEMA,
    protocolVersion: MANAGED_SUBJECT_METADATA_PROTOCOL_VERSION,
    engine: {
      moduleId: boundedString(value.engine.moduleId, 'engine.moduleId', IDENTIFIER),
      interfaceVersion: positiveInteger(value.engine.interfaceVersion, 'engine.interfaceVersion'),
      byteLength: byteLength(value.engine.byteLength, 'engine.byteLength'),
      sha256: boundedString(value.engine.sha256, 'engine.sha256', SHA256),
    },
    subject: {
      projectId: boundedString(value.subject.projectId, 'subject.projectId', IDENTIFIER),
      productCommit: boundedString(value.subject.productCommit, 'subject.productCommit', COMMIT),
      cleanTreeDigest: boundedString(value.subject.cleanTreeDigest, 'subject.cleanTreeDigest', SHA256),
      storageSchemaVersion: positiveInteger(value.subject.storageSchemaVersion, 'subject.storageSchemaVersion'),
      storageSchemaDigest: boundedString(value.subject.storageSchemaDigest, 'subject.storageSchemaDigest', SHA256),
    },
    adapter: {
      moduleId: boundedString(value.adapter.moduleId, 'adapter.moduleId', IDENTIFIER),
      interfaceVersion: positiveInteger(value.adapter.interfaceVersion, 'adapter.interfaceVersion'),
      byteLength: byteLength(value.adapter.byteLength, 'adapter.byteLength'),
      sha256: boundedString(value.adapter.sha256, 'adapter.sha256', SHA256),
      controlPlaneSchemaVersion: positiveInteger(value.adapter.controlPlaneSchemaVersion, 'adapter.controlPlaneSchemaVersion'),
      compatibleStorageSchemaVersion: positiveInteger(value.adapter.compatibleStorageSchemaVersion, 'adapter.compatibleStorageSchemaVersion'),
      compatibleStorageSchemaDigest: boundedString(value.adapter.compatibleStorageSchemaDigest, 'adapter.compatibleStorageSchemaDigest', SHA256),
    },
  };
  return freezeMetadata(metadata);
}

/** Canonical bounded UTF-8/LF bytes for independent engine, subject, and adapter observations. */
export function canonicalManagedSubjectMetadataBytesV1(value) {
  const metadata = validateManagedSubjectMetadataV1(value);
  const fields = [
    ['schema', metadata.schema], ['protocol-version', String(metadata.protocolVersion)],
    ['E-module-id', metadata.engine.moduleId], ['E-interface-version', String(metadata.engine.interfaceVersion)],
    ['E-byte-length', String(metadata.engine.byteLength)], ['E-sha256', metadata.engine.sha256],
    ['S-project-id', metadata.subject.projectId], ['S-product-commit', metadata.subject.productCommit],
    ['S-clean-tree-digest', metadata.subject.cleanTreeDigest], ['S-storage-schema-version', String(metadata.subject.storageSchemaVersion)],
    ['S-storage-schema-digest', metadata.subject.storageSchemaDigest],
    ['A-module-id', metadata.adapter.moduleId], ['A-interface-version', String(metadata.adapter.interfaceVersion)],
    ['A-byte-length', String(metadata.adapter.byteLength)], ['A-sha256', metadata.adapter.sha256],
    ['A-control-plane-schema-version', String(metadata.adapter.controlPlaneSchemaVersion)],
    ['A-compatible-storage-schema-version', String(metadata.adapter.compatibleStorageSchemaVersion)],
    ['A-compatible-storage-schema-digest', metadata.adapter.compatibleStorageSchemaDigest],
  ];
  const bytes = Buffer.concat(fields.map(([label, field]) => frame(label, field)));
  if (bytes.length > MANAGED_SUBJECT_METADATA_MAX_FRAME_BYTES) {
    fail('Metadata frame exceeds the v1 bound', 'MANAGED_SUBJECT_METADATA_FRAME_TOO_LARGE');
  }
  return bytes;
}

/** Parses captured bytes only; accepted v1 bytes describe untrusted observations, never native authority. */
export function parseManagedSubjectMetadataV1(value) {
  const bytes = capturedBytes(value);
  const fields = parseFrames(bytes);
  const metadata = validateManagedSubjectMetadataV1({
    schema: fields.get('schema'),
    protocolVersion: Number(fields.get('protocol-version')),
    engine: {
      moduleId: fields.get('E-module-id'), interfaceVersion: Number(fields.get('E-interface-version')),
      byteLength: Number(fields.get('E-byte-length')), sha256: fields.get('E-sha256'),
    },
    subject: {
      projectId: fields.get('S-project-id'), productCommit: fields.get('S-product-commit'),
      cleanTreeDigest: fields.get('S-clean-tree-digest'), storageSchemaVersion: Number(fields.get('S-storage-schema-version')),
      storageSchemaDigest: fields.get('S-storage-schema-digest'),
    },
    adapter: {
      moduleId: fields.get('A-module-id'), interfaceVersion: Number(fields.get('A-interface-version')),
      byteLength: Number(fields.get('A-byte-length')), sha256: fields.get('A-sha256'),
      controlPlaneSchemaVersion: Number(fields.get('A-control-plane-schema-version')),
      compatibleStorageSchemaVersion: Number(fields.get('A-compatible-storage-schema-version')),
      compatibleStorageSchemaDigest: fields.get('A-compatible-storage-schema-digest'),
    },
  });
  if (!Buffer.from(canonicalManagedSubjectMetadataBytesV1(metadata)).equals(bytes)) {
    fail('Metadata bytes are not canonical v1 observations', 'MANAGED_SUBJECT_METADATA_INVALID');
  }
  return metadata;
}
