import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorEnvelope, errorEnvelopeSchema } from './error.ts';

void test('errorEnvelope produces a schema-valid body without details', () => {
  const body = errorEnvelope('not_authenticated', 'Not authenticated', {
    requestId: 'request-1',
  });
  assert.deepEqual(body, {
    error: {
      code: 'not_authenticated',
      message: 'Not authenticated',
      requestId: 'request-1',
      retryable: false,
    },
  });
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('errorEnvelope includes details when provided', () => {
  const body = errorEnvelope('validation_failed', 'Bad input', {
    details: { field: 'ids' },
    requestId: 'request-2',
  });
  assert.deepEqual(body.error.details, { field: 'ids' });
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});

void test('errorEnvelopeSchema rejects a bare string error body', () => {
  const result = errorEnvelopeSchema.safeParse({ error: 'Not authenticated' });
  assert.equal(result.success, false);
});
