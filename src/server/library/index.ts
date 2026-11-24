import 'server-only';

import { randomBytes } from 'node:crypto';

import { errorEnvelope } from '~/contracts/v1/error';
import { ActivityMutationError } from '~/server/application/activities';
import type { Actor } from '~/server/auth/actor';
import { updateUserInternal } from '~/server/auth/users';
import { convexAppAdapter } from '~/server/library/convex';
import {
  catalogueIdentity,
  matchingVersion,
} from '~/server/places/matching-version';
import {
  type ConvexWriter,
  convexWriteBridge,
} from '~/server/sync/convex-writer';

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
export async function startLibrary(
  actor: Actor,
  deps: {
    writer?: ConvexWriter;
    recordAssignment?: (
      userId: string,
      assignment: { writer: 'convex'; convexEpoch: string },
    ) => Promise<unknown>;
  } = {},
): Promise<string> {
  const writer = deps.writer ?? bridge(actor);
  type State = {
    epoch: string;
    writer: string;
    writerEpoch: number;
    revoked: boolean;
  };
  let state = await writer.write<State | null>({ kind: 'state' });
  if (!state) {
    // The live catalogue once it has been published, before that the newest
    // complete rowset (`places.latestCatalogue` in the backend).
    const latest = await writer.write<{
      snapshotId: string;
      revision: string;
    } | null>({ kind: 'latestCatalogue' });
    const version = matchingVersion(
      latest ?? { snapshotId: null, revision: '0' },
    );
    try {
      await writer.write({
        kind: 'provision',
        epoch: randomBytes(24).toString('base64url'),
        generation: randomBytes(24).toString('base64url'),
        catalogue: catalogueIdentity(version),
        matchingVersion: version,
      });
    } catch (error) {
      // Concurrent first-use requests may race to provision. Only an owner
      // now confirmed through the same fenced bridge satisfies this request.
      state = await writer.write<State | null>({ kind: 'state' });
      if (!state) throw error;
    }
    state ??= await writer.write<State | null>({ kind: 'state' });
    if (!state) throw new Error('The library could not be started');
  }
  if (state.revoked || state.writer === 'handoff')
    throw new Error(
      'Library assignment is unavailable during revocation or handoff',
    );
  if (state.writer !== 'convex') {
    const assigned = await writer.write<number | null>({
      kind: 'setWriter',
      writer: 'convex',
      expectedEpoch: state.writerEpoch,
    });
    if (assigned === null) throw new Error('Library assignment changed; retry');
  }
  await (deps.recordAssignment ?? updateUserInternal)(actor.userId, {
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
    writer?: ConvexWriter;
    knownActivityCount?: () => Promise<number>;
  } = {},
): Promise<number> {
  const epoch = actor.convexEpoch ?? (await startLibrary(actor));
  const writer = deps.writer ?? bridge(actor);
  const requestedAt = (deps.now ?? Date.now)();
  const started = await writer.write<boolean>({ kind: 'sweepNow' }, epoch);
  const now = deps.now ?? Date.now;
  const wait =
    deps.wait ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const deadline = now() + WAIT_MS;
  type Sweep = {
    phase: 'idle' | 'scanning' | 'confirming';
    page: number;
    error: string | null;
    dueAt: number;
    running: boolean;
    completedAt: number | null;
  };
  let sweep: Sweep | null = null;
  let scanComplete = false;
  for (;;) {
    sweep = await writer.write<Sweep | null>({ kind: 'sweepStatus' }, epoch);
    scanComplete =
      sweep?.phase === 'confirming' ||
      (sweep?.phase === 'idle' &&
        sweep.completedAt != null &&
        (!started || sweep.completedAt >= requestedAt));
    if (
      scanComplete ||
      (sweep?.phase === 'scanning' && sweep.page > 2) ||
      (sweep?.error && !sweep.running) ||
      now() >= deadline
    )
      break;
    await wait(POLL_MS);
  }
  const count = deps.knownActivityCount
    ? await deps.knownActivityCount()
    : (await convexAppAdapter(actor, epoch).loadStatus(actor, new Date()))
        .history.knownActivityCount;
  if (count > 0) return Math.min(FIRST_FETCH, count);
  // Zero is a confirmed empty Strava library only after its list was read.
  // A pending or failed background import must reach the existing error UI.
  if (scanComplete && !sweep?.error) return 0;
  if (sweep?.error === 'credentials_rejected')
    throw new ActivityMutationError(
      'strava_not_connected',
      'Reconnect Strava to import your activities.',
      409,
    );
  const retryAfter = Math.max(
    30,
    Math.ceil(((sweep?.dueAt ?? now()) - now()) / 1000),
  );
  if (sweep?.error === 'rate_limited')
    throw new ActivityMutationError(
      'rate_limited',
      'Strava is limiting requests. Your activities will be imported when the limit resets.',
      429,
      true,
      retryAfter,
    );
  throw new ActivityMutationError(
    'upstream_unavailable',
    sweep?.error === 'The provider gateway is not configured'
      ? 'The Strava importer is not configured for this environment.'
      : sweep?.error
        ? 'The Strava import could not complete. Please try again.'
        : 'Your activities are still being imported. Please try again shortly.',
    503,
    true,
    30,
  );
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
