// Validates the TORCH v2 contract schemas (docs/v2/schemas/) and their fixtures.
//
// The schemas are JSON Schema 2020-12 documents, but the repo is dependency-free
// (nostr-tools + ws only), so this script interprets the deliberately small subset
// of keywords the v2 schemas are allowed to use. A schema using an unsupported
// keyword fails validation loudly rather than being silently ignored.
//
// Fixture convention: docs/v2/schemas/fixtures/valid/<schema-base>.<case>.json
// must pass its schema; fixtures/invalid/<schema-base>.<case>.json must fail.

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

export const SCHEMA_DIR = 'docs/v2/schemas';
export const FIXTURE_DIRS = {
  valid: join(SCHEMA_DIR, 'fixtures', 'valid'),
  invalid: join(SCHEMA_DIR, 'fixtures', 'invalid'),
};

const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'enum',
  'const',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
]);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

function typeMatches(declared, value) {
  const actual = typeOf(value);
  if (declared === 'number') {
    return actual === 'number' || actual === 'integer';
  }
  return declared === actual;
}

export function collectUnsupportedKeywords(schema, path = '#') {
  const unsupported = [];
  if (typeOf(schema) !== 'object') {
    return unsupported;
  }
  for (const [key, value] of Object.entries(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      unsupported.push(`${path}/${key}`);
      continue;
    }
    if (key === 'properties' && typeOf(value) === 'object') {
      for (const [prop, sub] of Object.entries(value)) {
        unsupported.push(...collectUnsupportedKeywords(sub, `${path}/properties/${prop}`));
      }
    }
    if (key === 'items') {
      unsupported.push(...collectUnsupportedKeywords(value, `${path}/items`));
    }
  }
  return unsupported;
}

export function validateAgainstSchema(schema, instance, path = '$') {
  const errors = [];

  if ('const' in schema && instance !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    return errors;
  }

  if ('enum' in schema) {
    if (!schema.enum.some((allowed) => allowed === instance)) {
      errors.push(`${path}: value ${JSON.stringify(instance)} not in enum`);
    }
    return errors;
  }

  if ('type' in schema && !typeMatches(schema.type, instance)) {
    errors.push(`${path}: expected type ${schema.type}, got ${typeOf(instance)}`);
    return errors;
  }

  if (typeof instance === 'string') {
    if ('minLength' in schema && instance.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if ('maxLength' in schema && instance.length > schema.maxLength) {
      errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
    }
    if ('pattern' in schema && !new RegExp(schema.pattern).test(instance)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
  }

  if (typeof instance === 'number') {
    if ('minimum' in schema && instance < schema.minimum) {
      errors.push(`${path}: below minimum ${schema.minimum}`);
    }
    if ('maximum' in schema && instance > schema.maximum) {
      errors.push(`${path}: above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(instance)) {
    if ('minItems' in schema && instance.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if ('maxItems' in schema && instance.length > schema.maxItems) {
      errors.push(`${path}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems) {
      const seen = new Set(instance.map((item) => JSON.stringify(item)));
      if (seen.size !== instance.length) {
        errors.push(`${path}: items are not unique`);
      }
    }
    if ('items' in schema) {
      instance.forEach((item, index) => {
        errors.push(...validateAgainstSchema(schema.items, item, `${path}[${index}]`));
      });
    }
  }

  if (typeOf(instance) === 'object') {
    const properties = schema.properties ?? {};
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in instance)) {
        errors.push(`${path}: missing required property "${requiredKey}"`);
      }
    }
    for (const [key, value] of Object.entries(instance)) {
      if (key in properties) {
        errors.push(...validateAgainstSchema(properties[key], value, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }

  return errors;
}

export function checkSchemaDocument(schema, fileName) {
  const problems = [];
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    problems.push(`${fileName}: $schema must declare draft 2020-12`);
  }
  if (typeof schema.title !== 'string' || schema.title.length === 0) {
    problems.push(`${fileName}: missing title`);
  }
  if (schema.type !== 'object') {
    problems.push(`${fileName}: top-level type must be object`);
  }
  if (schema.additionalProperties !== false) {
    problems.push(`${fileName}: top-level additionalProperties must be false`);
  }
  if (!Array.isArray(schema.required) || schema.required.length === 0) {
    problems.push(`${fileName}: top-level required must be a non-empty array`);
  }
  for (const keywordPath of collectUnsupportedKeywords(schema)) {
    problems.push(`${fileName}: unsupported schema keyword at ${keywordPath}`);
  }
  return problems;
}

export async function loadSchemas(rootDir = '.') {
  const dir = join(rootDir, SCHEMA_DIR);
  const schemas = new Map();
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith('.schema.json')) {
      continue;
    }
    const schema = JSON.parse(await readFile(join(dir, entry), 'utf8'));
    schemas.set(entry.replace(/\.schema\.json$/, ''), { schema, fileName: entry });
  }
  return schemas;
}

function schemaBaseForFixture(fixtureName, schemaBases) {
  const match = schemaBases.find((base) => fixtureName.startsWith(`${base}.`));
  return match ?? null;
}

export async function runValidation(rootDir = '.') {
  const failures = [];
  const schemas = await loadSchemas(rootDir);

  if (schemas.size === 0) {
    failures.push(`No schemas found in ${SCHEMA_DIR}`);
    return { failures, checked: 0 };
  }

  for (const { schema, fileName } of schemas.values()) {
    failures.push(...checkSchemaDocument(schema, fileName));
  }

  const schemaBases = [...schemas.keys()];
  let checked = 0;

  for (const [kind, fixtureDir] of Object.entries(FIXTURE_DIRS)) {
    for (const entry of await readdir(join(rootDir, fixtureDir))) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const base = schemaBaseForFixture(entry, schemaBases);
      if (!base) {
        failures.push(`${entry}: fixture name does not start with a known schema base`);
        continue;
      }
      const instance = JSON.parse(await readFile(join(rootDir, fixtureDir, entry), 'utf8'));
      const errors = validateAgainstSchema(schemas.get(base).schema, instance);
      checked += 1;
      if (kind === 'valid' && errors.length > 0) {
        failures.push(`${entry}: expected valid, got errors:\n  ${errors.join('\n  ')}`);
      }
      if (kind === 'invalid' && errors.length === 0) {
        failures.push(`${entry}: expected schema violations, but the fixture validated`);
      }
    }
  }

  return { failures, checked };
}

const isDirectRun = process.argv[1] && basename(process.argv[1]) === 'validate-v2-contracts.mjs';

if (isDirectRun) {
  const { failures, checked } = await runValidation();
  if (failures.length > 0) {
    console.error(`v2 contract validation failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`v2 contract validation passed (${checked} fixtures across ${SCHEMA_DIR}).`);
}
