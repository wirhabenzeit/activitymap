import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Structural check for the acceptance criterion in issue #120:
 * "Route Handlers and Server Actions can invoke the same service." Rather
 * than asserting on behavior (which would need a live database/session),
 * this proves the wiring: both transport layers import the same
 * application-service module, so there is exactly one implementation of
 * each use case for both to share.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

const read = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

void test('the activities Server Actions and the /api/activities Route Handler both call ~/server/application/activities', () => {
  const serverAction = read('src/server/strava/actions.ts');
  const dbServerAction = read('src/server/db/actions.ts');
  const routeHandler = read('src/app/api/activities/route.ts');

  for (const [label, source] of [
    ['src/server/strava/actions.ts', serverAction],
    ['src/server/db/actions.ts', dbServerAction],
    ['src/app/api/activities/route.ts', routeHandler],
  ] as const) {
    assert.match(
      source,
      /['"]~\/server\/application\/activities['"]/,
      `${label} must import the shared application service`,
    );
  }
});

void test('both /api/offline Route Handlers call ~/server/application/sync', () => {
  const bootstrapRoute = read('src/app/api/offline/bootstrap/route.ts');
  const changesRoute = read('src/app/api/offline/changes/route.ts');

  for (const [label, source] of [
    ['src/app/api/offline/bootstrap/route.ts', bootstrapRoute],
    ['src/app/api/offline/changes/route.ts', changesRoute],
  ] as const) {
    assert.match(
      source,
      /['"]~\/server\/application\/sync['"]/,
      `${label} must import the shared application service`,
    );
  }
});
