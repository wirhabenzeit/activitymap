import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import {
  ingestionStatusDTOSchema,
  type IngestionStatusDTO,
} from '~/contracts/v1/ingestion-status.ts';
import type { Actor } from '~/server/auth/actor';
import { createIngestionStatusHandler } from './handler.ts';

const now = new Date('2026-10-05T12:00:00.000Z');
const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../../../shared/ingestion-status-fixtures.v1.json', import.meta.url),
    'utf8',
  ),
) as { scenarios: { id: string; status: IngestionStatusDTO }[] };
const status = fixtures.scenarios.find(
  (scenario) => scenario.id === 'partial-import-with-detail-failures',
)!.status;

const actor: Actor = { userId: 'user-1', athleteId: 42, authentication: 'bearer' };
const request = () => new Request('https://example.test/api/v1/ingestion-status');

void test('GET /api/v1/ingestion-status serves the actor’s status in a privately cacheable envelope', async () => {
  const loaded: { actor: Actor; observedAt: Date }[] = [];
  const GET = createIngestionStatusHandler({
    now: () => now,
    resolveActor: async () => actor,
    loadStatus: async (resolved, observedAt) => {
      loaded.push({ actor: resolved, observedAt });
      return status;
    },
  });

  const response = await GET(request());
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('cache-control'),
    'private, max-age=60',
  );
  assert.deepEqual(loaded, [{ actor, observedAt: now }]);
  assert.equal(
    responseEnvelope(ingestionStatusDTOSchema).safeParse(body).success,
    true,
  );
  assert.deepEqual(body, {
    schemaVersion: '1',
    serverTime: now.toISOString(),
    data: status,
  });
});

void test('GET /api/v1/ingestion-status requires authentication and never loads status without an actor', async () => {
  let loads = 0;
  const GET = createIngestionStatusHandler({
    resolveActor: async () => null,
    loadStatus: async () => {
      loads += 1;
      return status;
    },
  });

  const response = await GET(request());
  const body = errorEnvelopeSchema.parse(await response.json());

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'not_authenticated');
  assert.equal(loads, 0);
});

void test('GET /api/v1/ingestion-status hides internal failures behind a safe retryable error', async () => {
  const errors: unknown[] = [];
  const GET = createIngestionStatusHandler({
    resolveActor: async () => actor,
    loadStatus: async () => {
      throw new Error('relation "secret_table" does not exist');
    },
    onError: (error) => errors.push(error),
  });

  const response = await GET(request());
  const serialized = await response.text();
  const body = errorEnvelopeSchema.parse(JSON.parse(serialized));

  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'internal_error');
  assert.equal(body.error.retryable, true);
  assert.equal(serialized.includes('secret_table'), false);
  assert.equal(errors.length, 1);
});

void test('GET /api/v1/ingestion-status refuses to serve a status that breaks its contract', async () => {
  const GET = createIngestionStatusHandler({
    resolveActor: async () => actor,
    loadStatus: async () =>
      ({ ...status, details: { ...status.details, detailed: -1 } }),
  });

  assert.equal((await GET(request())).status, 500);
});
