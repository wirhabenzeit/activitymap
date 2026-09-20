import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from './openapi.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkedInPath = join(__dirname, '..', '..', '..', 'openapi', 'v1.json');

void test('the checked-in openapi/v1.json matches the current contracts (run `tsx scripts/generate-openapi.ts` if this fails)', () => {
  const checkedIn = readFileSync(checkedInPath, 'utf8');
  const regenerated = JSON.stringify(buildOpenApiDocument(), null, 2) + '\n';
  assert.equal(regenerated, checkedIn);
});

void test('the document declares OpenAPI 3.1', () => {
  const document = buildOpenApiDocument();
  assert.equal(document.openapi, '3.1.0');
});

void test('every $ref resolves to a defined component schema', () => {
  const document = buildOpenApiDocument();
  const schemas = document.components.schemas;
  const refs = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      const ref = (node as Record<string, unknown>).$ref;
      if (typeof ref === 'string') refs.add(ref);
      Object.values(node).forEach(walk);
    }
  };
  walk(document);

  assert.ok(refs.size > 0, 'expected at least one $ref in the document');
  for (const ref of refs) {
    const name = ref.replace('#/components/schemas/', '');
    assert.ok(
      ref.startsWith('#/components/schemas/') && name in schemas,
      `unresolved $ref: ${ref}`,
    );
  }
});

void test('component schemas do not leak JSON Schema $id/$schema keys', () => {
  const document = buildOpenApiDocument();
  const serialized = JSON.stringify(document.components.schemas);
  assert.equal(serialized.includes('"$id"'), false);
  assert.equal(serialized.includes('"$schema"'), false);
});
