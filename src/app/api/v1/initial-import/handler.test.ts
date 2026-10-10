import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialImportHandler } from './handler';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { initialImportDTOSchema } from '~/contracts/v1/initial-import';

const actor = {
  userId: 'alice',
  athleteId: 42,
  authentication: 'cookie' as const,
};
const progress = {
  phase: 'not_started' as const,
  importedCount: 0,
  target: 200,
  historyComplete: false,
  retryAt: null,
  message: null,
};
void test('GET is read-only and cookie and bearer POSTs use only the resolved actor', async () => {
  let mutations = 0;
  const handler = createInitialImportHandler({
    resolveActor: async () => actor,
    read: async () => progress,
    advance: async (actual) => {
      assert.equal(actual, actor);
      mutations++;
      return progress;
    },
  });
  const result = await handler(
    new Request('https://activitymap.cc/api/v1/initial-import'),
  );
  assert.equal(mutations, 0);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  responseEnvelope(initialImportDTOSchema).parse(await result.json());
  for (const headers of [
    new Headers({ Origin: 'https://activitymap.cc' }),
    new Headers({ Authorization: 'Bearer test-only' }),
  ]) {
    assert.equal(
      (
        await handler(
          new Request(
            'https://activitymap.cc/api/v1/initial-import?athleteId=99&limit=99999',
            { method: 'POST', headers },
          ),
        )
      ).status,
      200,
    );
  }
  assert.equal(mutations, 2);
});
void test('signed-out and cross-origin calls cannot start an import', async () => {
  const deps = {
    read: async () => progress,
    advance: async () => {
      throw new Error('must not mutate');
    },
  };
  const request = new Request('https://activitymap.cc/api/v1/initial-import', {
    method: 'POST',
    headers: { Origin: 'https://elsewhere.example' },
  });
  assert.equal(
    (
      await createInitialImportHandler({
        ...deps,
        resolveActor: async () => null,
      })(request)
    ).status,
    401,
  );
  assert.equal(
    (
      await createInitialImportHandler({
        ...deps,
        resolveActor: async () => actor,
      })(request)
    ).status,
    403,
  );
});
