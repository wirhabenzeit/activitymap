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
