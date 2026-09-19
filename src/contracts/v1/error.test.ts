import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorEnvelope, errorEnvelopeSchema } from './error.ts';

void test('errorEnvelope produces a schema-valid body without details', () => {
  const body = errorEnvelope('unauthorized', 'Not authenticated');
  assert.deepEqual(body, { error: { code: 'unauthorized', message: 'Not authenticated' } });
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('errorEnvelope includes details when provided', () => {
  const body = errorEnvelope('validation_failed', 'Bad input', { field: 'ids' });
  assert.deepEqual(body.error.details, { field: 'ids' });
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('errorEnvelopeSchema rejects a bare string error body', () => {
  const result = errorEnvelopeSchema.safeParse({ error: 'Not authenticated' });
  assert.equal(result.success, false);
});
