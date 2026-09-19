import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { responseEnvelope, makeEnvelope } from './envelope.ts';
import { SCHEMA_VERSION } from './primitives.ts';

void test('makeEnvelope stamps the current schemaVersion and a fresh serverTime', () => {
  const before = Date.now();
  const envelope = makeEnvelope({ items: [1, 2, 3] });
  const after = Date.now();

  assert.equal(envelope.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(envelope.data, { items: [1, 2, 3] });
  const serverTimeMs = new Date(envelope.serverTime).getTime();
  assert.ok(serverTimeMs >= before && serverTimeMs <= after);
});

void test('responseEnvelope validates a matching payload', () => {
  const schema = responseEnvelope(z.object({ items: z.array(z.string()) }));
  const result = schema.safeParse(makeEnvelope({ items: ['a', 'b'] }));
  assert.equal(result.success, true);
});

void test('responseEnvelope rejects a mismatched schemaVersion', () => {
  const schema = responseEnvelope(z.object({ items: z.array(z.string()) }));
  const result = schema.safeParse({
    schemaVersion: SCHEMA_VERSION + 1,
    serverTime: new Date().toISOString(),
    data: { items: ['a'] },
  });
  assert.equal(result.success, false);
});

void test('responseEnvelope rejects a non-ISO serverTime', () => {
  const schema = responseEnvelope(z.object({ items: z.array(z.string()) }));
  const result = schema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    serverTime: 'not-a-date',
    data: { items: ['a'] },
  });
  assert.equal(result.success, false);
});
