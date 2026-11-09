import assert from 'node:assert/strict';

import { convexTest } from 'convex-test';
import test from 'node:test';

import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './library.ts': () => import('../convex/library'),
  './owners.ts': () => import('../convex/owners'),
};

const owner = {
  userId: 'viewer-owner',
  athleteId: '42',
  epoch: 'viewer-owner-epoch-01',
  generation: 'viewer-generation-01',
  catalogue: 'a'.repeat(64),
  matchingVersion: 'b'.repeat(64),
};
const signedIn = (subject: string) => ({
  subject,
  issuer: 'https://test.activitymap.cc',
});

void test('the token subject resolves the served owner; nothing else does', async () => {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, {
    ...owner,
    backend: 'convex',
  });
  await convex.mutation(internal.owners.provision, {
    ...owner,
    userId: 'postgres-owner',
    epoch: 'postgres-owner-epoch-01',
    backend: 'postgres',
  });

  assert.deepEqual(await convex.query(api.library.whoami, {}), {
    signedIn: false,
    userId: null,
    athleteId: null,
    served: false,
  });
  assert.deepEqual(
    await convex
      .withIdentity(signedIn('viewer-owner'))
      .query(api.library.whoami, {}),
    { signedIn: true, userId: 'viewer-owner', athleteId: '42', served: true },
  );
  // Signed in, but not (or not yet) served from Convex.
  for (const subject of ['unknown-user', 'postgres-owner'])
    assert.deepEqual(
      await convex
        .withIdentity(signedIn(subject))
        .query(api.library.whoami, {}),
      { signedIn: true, userId: subject, athleteId: null, served: false },
    );

  await convex.mutation(internal.owners.revoke, {
    userId: owner.userId,
    athleteId: owner.athleteId,
    epoch: owner.epoch,
  });
  assert.equal(
    (
      await convex
        .withIdentity(signedIn('viewer-owner'))
        .query(api.library.whoami, {})
    ).served,
    false,
    'revocation hides the owner immediately',
  );
});
