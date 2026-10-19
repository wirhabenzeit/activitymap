import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import test from 'node:test';

import { activityDTOSchema } from '~/contracts/v1/activity';
import { makeEnvelope } from '~/contracts/v1/envelope';

import { completeActivityMutation } from './activity-mutation';
import {
  ActivityCommandError,
  refreshActivityCommand,
  saveActivityCommand,
} from './activity-mutation-client';

const gallery = JSON.parse(
  readFileSync(
    new URL(
      '../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { activities: unknown[] };
const activity = activityDTOSchema.parse({
  ...Object.fromEntries(
    Object.keys(activityDTOSchema.shape)
      .filter((key) => key !== 'streams')
      .map((key) => [key, null]),
  ),
  ...(gallery.activities[0] as Record<string, unknown>),
  name: 'A',
  description: '',
});
const committed = { activity, photosError: null };

void test('remote committed data is retained when local reconciliation fails', async () => {
  const failure = new Error('disk full');
  const outcome = await completeActivityMutation(
    committed,
    () => Promise.reject(failure),
    () => true,
  );
  assert.equal(outcome.activity, activity);
  assert.equal(outcome.activity.description, '');
  assert.equal(outcome.cacheError, failure);
});

void test('partial photo success and account departure never replace prior photos', async () => {
  const photosError = {
    code: 'upstream_rate_limited',
    retryable: true,
    retry_after_seconds: 35,
  };
  const outcome = await completeActivityMutation(
    { ...committed, photosError },
    async () => {
      /* Successful reconciliation. */
    },
    () => true,
  );
  assert.equal(outcome.photos, undefined);
  assert.deepEqual(outcome.photosError, photosError);
  const departed = await completeActivityMutation(
    committed,
    () => {
      assert.fail('departed account cannot reconcile');
    },
    () => false,
  );
  assert.equal(departed.cacheError, null);
});

void test('PATCH preserves empty description and consumes returned committed DTO', async () => {
  const result = await saveActivityCommand(
    Number(activity.id),
    { name: 'A', description: '' },
    undefined,
    async (url, init) => {
      assert.equal(url, `/api/v1/activities/${activity.id}`);
      assert.equal(init?.method, 'PATCH');
      assert.equal(init?.credentials, 'include');
      assert.equal(typeof init?.body, 'string');
      assert.deepEqual(JSON.parse(init?.body as string), {
        name: 'A',
        description: '',
      });
      return Response.json(makeEnvelope(activity));
    },
  );
  assert.deepEqual(result, activity);
});

void test('refresh retains partial photo retry classification', async () => {
  const partial = {
    activity,
    photos: [],
    photos_status: 'partial',
    photos_error: {
      code: 'upstream_rate_limited',
      retryable: true,
      retry_after_seconds: 35,
    },
  };
  const result = await refreshActivityCommand(
    Number(activity.id),
    undefined,
    async (url, init) => {
      assert.equal(url, `/api/v1/activities/${activity.id}/refresh`);
      assert.equal(init?.method, 'POST');
      return Response.json(makeEnvelope(partial));
    },
  );
  assert.deepEqual(result, partial);
});

void test('mutation failures retain request, retry and remote-success recovery facts', async () => {
  const before = Date.now();
  await assert.rejects(
    saveActivityCommand(7, { description: '' }, undefined, async () =>
      Response.json(
        {
          error: {
            message: 'Strava accepted the edit; refresh before retrying.',
            code: 'local_state_conflict',
            retryable: false,
            requestId: 'request-123',
            details: {
              upstreamSucceeded: true,
              recovery: 'refresh_before_retry',
            },
          },
        },
        { status: 409, headers: { 'Retry-After': '35' } },
      ),
    ),
    (error: unknown) => {
      assert(error instanceof ActivityCommandError);
      assert.equal(error.facts.requestId, 'request-123');
      assert.equal(error.facts.retryable, false);
      assert((error.facts.retryAt ?? 0) >= before + 35_000);
      assert.deepEqual(error.facts.details, {
        upstreamSucceeded: true,
        recovery: 'refresh_before_retry',
      });
      return true;
    },
  );
});

void test('invalid or wrong-activity success responses require refresh before another write', async () => {
  for (const body of [
    makeEnvelope({ ...activity, id: '999999' }),
    { data: null },
  ]) {
    await assert.rejects(
      saveActivityCommand(
        Number(activity.id),
        { description: '' },
        undefined,
        async () =>
          Response.json(body, { headers: { 'X-Request-Id': 'response-id' } }),
      ),
      (error: unknown) => {
        assert(error instanceof ActivityCommandError);
        assert.equal(error.requiresRefresh, true);
        assert.equal(error.facts.requestId, 'response-id');
        assert.equal(error.facts.retryable, false);
        assert.deepEqual(error.facts.details, {
          recovery: 'refresh_before_retry',
        });
        return true;
      },
    );
  }
});

void test('response header request ID takes precedence over a stale body request ID', async () => {
  await assert.rejects(
    refreshActivityCommand(7, undefined, async () =>
      Response.json(
        {
          error: {
            code: 'upstream_unavailable',
            message: 'Try later.',
            retryable: true,
            requestId: 'body-id',
          },
        },
        { status: 503, headers: { 'X-Request-Id': 'header-id' } },
      ),
    ),
    (error: unknown) => {
      assert(error instanceof ActivityCommandError);
      assert.equal(error.facts.requestId, 'header-id');
      return true;
    },
  );
});
