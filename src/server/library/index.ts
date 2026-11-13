import 'server-only';

import { randomBytes } from 'node:crypto';

import { errorEnvelope } from '~/contracts/v1/error';
import type { Actor } from '~/server/auth/actor';
import { updateUserInternal } from '~/server/auth/users';
import { convexAppAdapter } from '~/server/library/convex';
import {
  catalogueIdentity,
  matchingVersion,
} from '~/server/places/matching-version';
import { convexWriteBridge } from '~/server/sync/convex-writer';

/**
 * An account's library: its activities, recordings, photos and place
 * matches. It lives in the Convex backend (`backend/`), which also fetches
 * it from the provider. The app reaches it through two signed bridges: reads
 * (`~/server/library/convex.ts`) and changes (`~/server/sync/convex-writer.ts`).
 */

function bridge(actor: Actor) {
  const writer = convexWriteBridge(actor);
  if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  return writer;
}

/**
 * Give an account its library, if it has none, and record the library's
 * routing epoch on the user. Safe to repeat. Returns the epoch.
 */
export async function startLibrary(actor: Actor): Promise<string> {
  const writer = bridge(actor);
  type State = { epoch: string; writer: string; writerEpoch: number };
  let state = await writer.write<State | null>({ kind: 'state' });
  if (!state) {
    const rowset = await writer.write<{
      snapshotId: string;
      revision: string;
    } | null>({ kind: 'latestCatalogue' });
    const version = matchingVersion(
      rowset ?? { snapshotId: null, revision: '0' },
    );
    await writer.write({
      kind: 'provision',
      epoch: randomBytes(24).toString('base64url'),
      generation: randomBytes(24).toString('base64url'),
      catalogue: catalogueIdentity(version),
      matchingVersion: version,
    });
    state = await writer.write<State | null>({ kind: 'state' });
    if (!state) throw new Error('The library could not be started');
  }
  // An owner starts as a copy that something else writes; here Convex
  // writes it from the start.
  if (state.writer !== 'convex')
    await writer.write({
      kind: 'setWriter',
      writer: 'convex',
      expectedEpoch: state.writerEpoch,
    });
  await updateUserInternal(actor.userId, {
    writer: 'convex',
    convexEpoch: state.epoch,
  });
  return state.epoch;
}

/** The account's library, started first if the account is new. Null without
 * an actor: the caller answers that the request is not authenticated. */
export async function libraryFor(actor: Actor | null) {
  if (!actor) return null;
  return convexAppAdapter(
    actor,
    actor.convexEpoch ?? (await startLibrary(actor)),
  );
}

export type Library = NonNullable<Awaited<ReturnType<typeof libraryFor>>>;

const FIRST_FETCH = 200;
const WAIT_MS = 15_000;
const POLL_MS = 500;

/**
 * The first fetch of an account's activities: start reading the provider's
 * list and wait briefly, so the first screen has something to show. Returns
 * how many activities are known by then, at most a first screenful.
 */
export async function firstFetch(
  actor: Actor,
  deps: {
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<number> {
  const epoch = actor.convexEpoch ?? (await startLibrary(actor));
  const writer = bridge(actor);
  await writer.write({ kind: 'sweepNow' }, epoch);
  const now = deps.now ?? Date.now;
  const wait =
    deps.wait ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const deadline = now() + WAIT_MS;
  // Until the sweep has read two pages, or has finished reading.
  for (;;) {
    const sweep = await writer.write<{ phase: string; page: number } | null>(
      { kind: 'sweepStatus' },
      epoch,
    );
    if (sweep && (sweep.phase !== 'scanning' || sweep.page > 2)) break;
    if (now() >= deadline) break;
    await wait(POLL_MS);
  }
  const status = await convexAppAdapter(actor, epoch).loadStatus(
    actor,
    new Date(),
  );
  return Math.min(FIRST_FETCH, status.history.knownActivityCount);
}

/** Answer for a request without an actor. */
export function notAuthenticated(requestId: string) {
  return Response.json(
    errorEnvelope('not_authenticated', 'Authentication is required.', {
      requestId,
    }),
    { status: 401 },
  );
}
