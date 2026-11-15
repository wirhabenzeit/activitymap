import assert from 'node:assert/strict';

import test from 'node:test';

import { ActivityMutationError } from '~/server/application/activities';
import type { Actor } from '~/server/auth/actor';

import {
  type ActivityMergeHandlerDeps,
  createContinueMergeUploadHandler,
  createMergeActivitiesHandler,
  createMergeFileHandler,
} from './handler';

const actor: Actor = { userId: 'u1', athleteId: 42, authentication: 'cookie' };
const body = {
  activity_ids: ['1', '2'],
  name: 'Merged',
  description: '',
  sport_type: 'Ride',
};
const post = (value: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/v1/activity-merges', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.test',
      ...headers,
    },
    body: JSON.stringify(value),
  });
const deps = (
  overrides: Partial<ActivityMergeHandlerDeps> = {},
): ActivityMergeHandlerDeps => ({
  resolveActor: async () => actor,
  isEnabled: () => true,
  now: () => new Date('2026-06-02T00:00:00Z'),
  ...overrides,
});

void test('requires a signed-in athlete the feature is enabled for', async () => {
  const anonymous = await createMergeActivitiesHandler(
    deps({ resolveActor: async () => null }),
  )(post(body));
  assert.equal(anonymous.status, 401);
  const disabled = await createMergeActivitiesHandler(
    deps({ isEnabled: () => false }),
  )(post(body));
  assert.equal(disabled.status, 404);
  const foreign = await createMergeActivitiesHandler(deps())(
    post(body, { origin: 'https://evil.test' }),
  );
  assert.equal(foreign.status, 403);
});

void test('validates the selection and metadata', async () => {
  for (const invalid of [
    { ...body, activity_ids: ['1'] },
    { ...body, activity_ids: ['1', '1'] },
    { ...body, name: '  ' },
    { ...body, sport_type: 'Teleport' },
  ]) {
    const response = await createMergeActivitiesHandler(deps())(post(invalid));
    assert.equal(response.status, 400, JSON.stringify(invalid));
  }
});

void test('answers the upload state in the v1 envelope', async () => {
  const response = await createMergeActivitiesHandler(
    deps({
      merge: async () => ({
        upload_id: '900',
        status: 'ready',
        activity_id: '555',
        error: null,
        duplicate_of: null,
        metadata_applied: true,
      }),
    }),
  )(post(body));
  assert.equal(response.status, 200);
  const json = (await response.json()) as { data: { activity_id: string } };
  assert.equal(json.data.activity_id, '555');
});

void test('reports merge blockers as 422 with their details', async () => {
  const response = await createMergeActivitiesHandler(
    deps({
      merge: async () => {
        throw new ActivityMutationError(
          'merge_not_allowed',
          'They overlap.',
          422,
          false,
          undefined,
          { blockers: [{ code: 'overlap', first: '1', second: '2' }] },
        );
      },
    }),
  )(post(body));
  assert.equal(response.status, 422);
  const json = (await response.json()) as { error: { code: string } };
  assert.equal(json.error.code, 'merge_not_allowed');
});

void test('the file endpoint answers a FIT attachment', async () => {
  const response = await createMergeFileHandler(
    deps({
      buildFile: async () => ({
        bytes: new Uint8Array([14, 16]),
        fileName: 'merged.fit',
        sources: [],
        sport: 'Ride',
        trainer: false,
      }),
    }),
  )(post({ activity_ids: ['1', '2'] }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/vnd.ant.fit');
  assert.match(
    response.headers.get('content-disposition') ?? '',
    /merged\.fit/,
  );
});

void test('the continue endpoint rejects malformed upload IDs', async () => {
  const response = await createContinueMergeUploadHandler(deps())(
    post(body),
    '../uploads',
  );
  assert.equal(response.status, 400);
});

void test('all merge endpoints default to the admin allowlist', async () => {
  const previous = process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS;
  try {
    for (const allowlist of [undefined, '7', '*', '7, 42']) {
      if (allowlist === undefined)
        delete process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS;
      else process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS = allowlist;
      let calls = 0;
      const state = {
        upload_id: '900',
        status: 'processing' as const,
        activity_id: null,
        error: null,
        duplicate_of: null,
        metadata_applied: false,
      };
      const defaults = deps({
        isEnabled: undefined,
        merge: async () => {
          calls++;
          return state;
        },
        continueUpload: async () => {
          calls++;
          return state;
        },
        buildFile: async () => {
          calls++;
          return {
            bytes: new Uint8Array([14]),
            fileName: 'merged.fit',
            sources: [],
            sport: 'Ride',
            trainer: false,
          };
        },
      });
      const responses = [
        await createMergeActivitiesHandler(defaults)(post(body)),
        await createMergeFileHandler(defaults)(
          post({ activity_ids: ['1', '2'] }),
        ),
        await createContinueMergeUploadHandler(defaults)(
          post({
            name: body.name,
            description: body.description,
            sport_type: body.sport_type,
          }),
          '900',
        ),
      ];
      const enabled = allowlist === '7, 42';
      assert.deepEqual(
        responses.map((response) => response.status),
        enabled ? [200, 200, 200] : [404, 404, 404],
      );
      assert.equal(calls, enabled ? 3 : 0);
    }
  } finally {
    if (previous === undefined)
      delete process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS;
    else process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS = previous;
  }
});
