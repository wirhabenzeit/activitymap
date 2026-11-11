import assert from 'node:assert/strict';

import test from 'node:test';

import { DEFAULT_SHARE_LINK_FIELD_OPTIONS } from '~/lib/sharing/fields';
import type { Actor } from '~/server/auth/actor';
import { hashShareToken } from '~/server/sharing/tokens';
import {
  MAX_SHARE_LINK_TTL_MS,
  MIN_SHARE_LINK_TTL_MS,
} from '~/server/sharing/validators';
import type {
  ConvexShareLink,
  ConvexShareLinks,
} from '~/server/sync/convex-shares';

import {
  ForbiddenError,
  ShareLinkNotFoundError,
  ShareLinkUnavailableError,
  createShareLinkForActor,
  getShareView,
  listShareLinksForActor,
  revokeShareLinkForActor,
} from './share-links.ts';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'cookie',
};
const NOW = new Date('2026-11-01T12:00:00.000Z');
const fields = DEFAULT_SHARE_LINK_FIELD_OPTIONS;

/** The library's side: it stores what it is given and owns ids 1 to 3. */
function library() {
  const stored: (ConvexShareLink & { tokenHash: string })[] = [];
  const links = {
    async create(input: {
      tokenHash: string;
      expiresAt: number;
      fields: typeof fields;
      activityIds: string[];
    }) {
      if (input.activityIds.some((id) => !['1', '2', '3'].includes(id)))
        return null;
      const link = {
        id: `link-${stored.length + 1}`,
        createdAt: NOW.getTime() + stored.length,
        revokedAt: null,
        ...input,
      };
      stored.push(link);
      return link;
    },
    list: async () => stored,
    async revoke(id: string) {
      const link = stored.find((candidate) => candidate.id === id);
      if (link?.revokedAt !== null) return false;
      link.revokedAt = NOW.getTime();
      return true;
    },
  } as unknown as ConvexShareLinks;
  return { stored, deps: { links: () => links, now: () => NOW } };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  activityIds: [1, 2],
  expiresInMs: MIN_SHARE_LINK_TTL_MS,
  fields,
  ...overrides,
});

void test('a link covers exactly the requested activities, and only the hash of its token is stored', async () => {
  const { stored, deps } = library();
  const created = await createShareLinkForActor(actor, input(), {
    ...deps,
    generateToken: () => 'plain-token',
  });
  assert.equal(created.token, 'plain-token');
  assert.deepEqual(created.activityIds, [1, 2]);
  assert.equal(
    created.expiresAt.getTime(),
    NOW.getTime() + MIN_SHARE_LINK_TTL_MS,
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.tokenHash, hashShareToken('plain-token'));
  assert.doesNotMatch(JSON.stringify(stored), /plain-token/);
});

void test('a link to an activity the library does not hold for the actor is refused', async () => {
  const { stored, deps } = library();
  await assert.rejects(
    createShareLinkForActor(actor, input({ activityIds: [1, 99] }), deps),
    ForbiddenError,
  );
  assert.equal(stored.length, 0);
});

void test('an empty selection and an expiry outside the bounds are refused before anything is stored', async () => {
  const { stored, deps } = library();
  for (const bad of [
    { activityIds: [] },
    { expiresInMs: MIN_SHARE_LINK_TTL_MS - 1 },
    { expiresInMs: MAX_SHARE_LINK_TTL_MS + 1 },
    { expiresInMs: undefined },
  ])
    await assert.rejects(createShareLinkForActor(actor, input(bad), deps));
  assert.equal(stored.length, 0);
});

void test('links are listed newest first with their status', async () => {
  const { stored, deps } = library();
  await createShareLinkForActor(actor, input(), deps);
  await createShareLinkForActor(actor, input({ activityIds: [3] }), deps);
  await createShareLinkForActor(actor, input(), deps);
  stored[0]!.expiresAt = NOW.getTime();
  await revokeShareLinkForActor(actor, 'link-2', deps);

  const listed = await listShareLinksForActor(actor, deps);
  assert.deepEqual(
    listed.map((link) => [link.id, link.status, link.activityCount]),
    [
      ['link-3', 'active', 2],
      ['link-2', 'revoked', 1],
      ['link-1', 'expired', 2],
    ],
  );
});

void test('revoking a link that is not the actor’s, or twice, is not found', async () => {
  const { deps } = library();
  await createShareLinkForActor(actor, input(), deps);
  await assert.rejects(
    revokeShareLinkForActor(actor, 'someone-elses', deps),
    ShareLinkNotFoundError,
  );
  await revokeShareLinkForActor(actor, 'link-1', deps);
  await assert.rejects(
    revokeShareLinkForActor(actor, 'link-1', deps),
    ShareLinkNotFoundError,
  );
});

void test('the shared view is read with the hash of the token', async () => {
  const asked: string[] = [];
  const shared = await getShareView('plain-token', {
    view: async (tokenHash) => {
      asked.push(tokenHash);
      return {
        athleteId: '42',
        createdAt: NOW.getTime(),
        expiresAt: NOW.getTime() + 1000,
        fields,
        activities: [],
      };
    },
    isAthleteRevoked: async () => false,
  });
  assert.deepEqual(asked, [hashShareToken('plain-token')]);
  assert.equal(shared.createdAt.getTime(), NOW.getTime());
  assert.deepEqual(shared.fields, fields);
});

void test('every way a link can fail is the same answer', async () => {
  const live = {
    athleteId: '42',
    createdAt: NOW.getTime(),
    expiresAt: NOW.getTime() + 1000,
    fields,
    activities: [],
  };
  // Unknown, expired and revoked links: the library answers null.
  await assert.rejects(
    getShareView('unknown', { view: async () => null }),
    ShareLinkUnavailableError,
  );
  await assert.rejects(
    getShareView('', { view: async () => live }),
    ShareLinkUnavailableError,
  );
  // The athlete withdrew access: their links stop before erasure runs.
  const asked: number[] = [];
  await assert.rejects(
    getShareView('plain-token', {
      view: async () => live,
      isAthleteRevoked: async (athleteId) => {
        asked.push(athleteId);
        return true;
      },
    }),
    ShareLinkUnavailableError,
  );
  assert.deepEqual(asked, [42]);
});
