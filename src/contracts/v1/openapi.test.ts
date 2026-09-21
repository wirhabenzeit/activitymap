import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from './openapi.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkedInPath = join(__dirname, '..', '..', '..', 'openapi', 'v1.json');
const apiV1Directory = join(__dirname, '..', '..', 'app', 'api', 'v1');
const HTTP_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);

function implementedV1Operations(): string[] {
  const operations: string[] = [];

  const walk = (directory: string, segments: string[]): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), [...segments, entry.name]);
        continue;
      }
      if (entry.name !== 'route.ts') continue;

      const source = readFileSync(join(directory, entry.name), 'utf8');
      const pathSegments = segments
        .filter((segment) => !/^\(.+\)$/.test(segment))
        .map((segment) => {
          const dynamic = /^\[(?:\.\.\.)?(.+)\]$/.exec(segment);
          return dynamic ? `{${dynamic[1]}}` : segment;
        });
      const path = `/api/v1/${pathSegments.join('/')}`;

      for (const match of source.matchAll(
        /export\s+const\s+(DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)\s*=/g,
      )) {
        operations.push(`${match[1]?.toLowerCase()} ${path}`);
      }
    }
  };

  walk(apiV1Directory, []);
  return operations.sort();
}

function documentedV1Operations(): string[] {
  const document = buildOpenApiDocument() as unknown as {
    paths: Record<string, Record<string, unknown>>;
  };
  const operations: string[] = [];

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (operation && HTTP_METHODS.has(method.toUpperCase())) {
        operations.push(`${method.toLowerCase()} ${path}`);
      }
    }
  }
  return operations.sort();
}

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

void test('every documented v1 operation has a Route Handler, and every Route Handler is documented', () => {
  assert.deepEqual(documentedV1Operations(), implementedV1Operations());
});

void test('every implemented rate-limited v1 operation documents 429', () => {
  const document = buildOpenApiDocument() as unknown as {
    paths: Record<
      string,
      Record<string, { responses: Record<string, unknown> } | undefined>
    >;
  };
  const operations = [
    ['get', '/api/v1/me'],
    ['get', '/api/v1/sync/bootstrap'],
    ['get', '/api/v1/sync/changes'],
    ['get', '/api/v1/activities'],
    ['get', '/api/v1/photos'],
    ['get', '/api/v1/auth/mobile/start'],
    ['get', '/api/v1/auth/mobile/callback'],
    ['post', '/api/v1/auth/mobile/exchange'],
    ['post', '/api/v1/auth/logout'],
    ['get', '/api/v1/auth/sessions'],
    ['post', '/api/v1/auth/sessions/revoke'],
  ] as const;

  for (const [method, path] of operations) {
    assert.ok(
      document.paths[path]?.[method]?.responses['429'],
      `${method.toUpperCase()} ${path} must document its rate-limit response`,
    );
  }
});
