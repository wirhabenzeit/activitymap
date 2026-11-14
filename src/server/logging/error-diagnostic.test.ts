import assert from 'node:assert/strict';

import test from 'node:test';
import { z } from 'zod';

import { errorDiagnostic } from './error-diagnostic';

void test('wrapped validation diagnostics retain field paths without provider values or error messages', () => {
  const parsed = z.object({ sport_type: z.enum(['Ride']) }).safeParse({
    sport_type: 'private-provider-value',
  });
  assert.equal(parsed.success, false);
  const error = new Error('access_token=secret-capability', {
    cause: parsed.error,
  });
  const diagnostic = errorDiagnostic(error);
  assert.deepEqual(diagnostic, {
    name: 'Error',
    cause: {
      name: 'ZodError',
      issues: [{ path: ['sport_type'], code: 'invalid_value' }],
    },
  });
  assert.equal(
    JSON.stringify(diagnostic).includes('private-provider-value'),
    false,
  );
  assert.equal(JSON.stringify(diagnostic).includes('secret-capability'), false);
  error.cause = error;
  assert.doesNotThrow(() => JSON.stringify(errorDiagnostic(error)));
});
