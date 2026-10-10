import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { summarizeJobResult } from './job-log.ts';
import {
  addRunFailure,
  describeFailure,
  MAX_RUN_FAILURES,
  type RunFailure,
} from './run-failures.ts';

void test('a Zod failure is described by issue paths and messages, never values', () => {
  const schema = z.object({ watts: z.object({ data: z.array(z.number()) }) });
  const parsed = schema.safeParse({
    watts: { data: [120, null, 'secret', null, null] },
  });
  assert.equal(parsed.success, false);
  const detail = describeFailure(parsed.error);
  assert.match(detail, /^ZodError: watts\.data\.1: /);
  assert.match(detail, /\(\+1 more\)$/);
  assert.doesNotMatch(detail, /secret/);
});

void test('an HTTP-style error keeps its status', () => {
  const error = Object.assign(new Error('Record Not Found'), {
    name: 'StravaApiError',
    status: 404,
  });
  assert.equal(describeFailure(error), 'StravaApiError 404: Record Not Found');
});

void test('a wrapped database error reports its cause, not the query', () => {
  const cause = new Error(
    'value "3000000000" is out of range for type integer',
  );
  const error = new Error(
    'Failed query: insert into "photos"\nparams: caption',
    {
      cause,
    },
  );
  error.name = 'DrizzleQueryError';
  assert.equal(
    describeFailure(error),
    'Error: value "3000000000" is out of range for type integer ← DrizzleQueryError',
  );
});

void test('a run keeps only its first failures', () => {
  const failures: RunFailure[] = [];
  for (let id = 1; id <= MAX_RUN_FAILURES + 5; id++)
    addRunFailure(failures, BigInt(id), 'upstream_error', new Error('boom'));
  assert.equal(failures.length, MAX_RUN_FAILURES);
  assert.deepEqual(failures[0], {
    activityId: '1',
    code: 'upstream_error',
    detail: 'Error: boom',
  });
});

void test('the job log summary keeps failures but drops other non-numeric fields', () => {
  const summary = summarizeJobResult({
    fetched: 39,
    failed: 1,
    stopReason: 'activity_limit',
    failures: [
      {
        activityId: '12989906490',
        code: 'invalid_response',
        detail: 'ZodError: watts.data.17: Invalid input',
        extra: 'dropped',
      },
      { activityId: 1 },
    ],
  });
  assert.deepEqual(summary, {
    fetched: 39,
    failed: 1,
    failures: [
      {
        activityId: '12989906490',
        code: 'invalid_response',
        detail: 'ZodError: watts.data.17: Invalid input',
      },
    ],
  });
  assert.deepEqual(summarizeJobResult({ fetched: 1, failures: [] }), {
    fetched: 1,
  });
});
