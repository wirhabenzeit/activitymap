import 'server-only';

import type { Actor } from '~/server/auth/actor';
import type { Activity } from '~/server/db/schema';
import {
  activitiesRepository,
  type ActivitiesRepository,
} from '~/server/repositories/activities';
import {
  shareLinksRepository,
  type ShareLinkRecord,
  type ShareLinksRepository,
} from '~/server/repositories/share-links';
import { generateShareToken, hashShareToken } from '~/server/sharing/tokens';
import {
  createShareLinkInputSchema,
  type CreateShareLinkInput,
} from '~/server/sharing/validators';
import type { ShareLinkFieldOptions } from '~/lib/sharing/fields';
import {
  toSharedActivityDTO,
  type SharedActivityDTO,
} from '~/contracts/share/activity';

/**
 * Application service for private, scoped, expiring share links (issue
 * #132). Like every other file under `~/server/application`, this has no
 * React/`next/*`/Route Handler imports (see
 * `~/server/application/framework-boundary.test.ts`) - transport code
 * (`~/server/share-actions.ts`'s `'use server'` actions, and
 * `~/app/share/[token]/page.tsx`) resolves an `Actor` (or, for the public
 * recipient view, nothing at all) and calls straight into this module.
 */

export class ForbiddenError extends Error {
  constructor(message = 'Not authorized to access this resource') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ShareLinkNotFoundError extends Error {
  constructor(message = 'Share link not found') {
    super(message);
    this.name = 'ShareLinkNotFoundError';
  }
}

/**
 * Thrown for every way a capability token can fail to serve data: unknown,
 * malformed, expired, revoked, or its owning athlete deauthorized. This is
 * deliberately a single error/message for all of those cases (issue #132's
 * "non-enumerable" requirement, docs/strava-data-policy.md §5): a recipient
 * - or anyone probing tokens - must not be able to use the response to tell
 * "this token never existed" apart from "it existed once and is now gone".
 * `~/app/share/[token]/page.tsx` maps this to an ordinary 404.
 */
export class ShareLinkUnavailableError extends Error {
  constructor(message = 'This share link is no longer available.') {
    super(message);
    this.name = 'ShareLinkUnavailableError';
  }
}

export type ShareLinksServiceDeps = {
  shareLinksRepo?: ShareLinksRepository;
  activitiesRepo?: ActivitiesRepository;
  now?: () => Date;
  generateToken?: () => string;
};

function resolveDeps(deps: ShareLinksServiceDeps) {
  return {
    shareLinksRepo: deps.shareLinksRepo ?? shareLinksRepository,
    activitiesRepo: deps.activitiesRepo ?? activitiesRepository,
    now: deps.now ?? (() => new Date()),
    generateToken: deps.generateToken ?? generateShareToken,
  };
}

export type CreatedShareLink = {
  id: string;
  /** The plaintext capability token. Returned exactly once - never persisted, logged, or returned again. */
  token: string;
  createdAt: Date;
  expiresAt: Date;
  fields: ShareLinkFieldOptions;
  activityIds: number[];
};

/**
 * Create a new share link for a subset of the actor's own activities.
 *
 * Every id in `input.activityIds` must already belong to the actor - unlike
 * `getActivitiesForActor`, this never silently drops an id that does not
 * belong to the caller. A share's entire point is an *explicit*, confirmed
 * subset (issue #132's "every share covers an explicit activity subset"
 * acceptance criterion): silently creating a link for fewer activities than
 * the athlete just confirmed on the review screen would be a silent
 * under-share, and one that reached into another athlete's activity id must
 * fail loudly instead of pretending the id does not exist.
 */
export async function createShareLinkForActor(
  actor: Actor,
  input: CreateShareLinkInput,
  deps: ShareLinksServiceDeps = {},
): Promise<CreatedShareLink> {
  const { shareLinksRepo, activitiesRepo, now, generateToken } = resolveDeps(deps);
  const parsed = createShareLinkInputSchema.parse(input);

  const owned = await activitiesRepo.findManyByIds(parsed.activityIds);
  const ownedIds = new Set(
    owned.filter((activity) => activity.athlete === actor.athleteId).map((a) => a.id),
  );
  const notOwned = parsed.activityIds.filter((id) => !ownedIds.has(id));
  if (notOwned.length > 0) {
    throw new ForbiddenError(
      'Cannot create a share link for activities that do not belong to you.',
    );
  }

  const token = generateToken();
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + parsed.expiresInMs);

  const record = await shareLinksRepo.create({
    athleteId: actor.athleteId,
    tokenHash: hashShareToken(token),
    expiresAt,
    fields: parsed.fields,
    activityIds: parsed.activityIds,
  });

  return {
    id: record.id,
    token,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    fields: record.fields,
    activityIds: record.activityIds,
  };
}

export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

export type ShareLinkSummary = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  fields: ShareLinkFieldOptions;
  activityCount: number;
  status: ShareLinkStatus;
};

function statusOf(record: ShareLinkRecord, now: Date): ShareLinkStatus {
  if (record.revokedAt) return 'revoked';
  if (record.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

/** Every share link the actor owns (any status), newest first - never another athlete's. */
export async function listShareLinksForActor(
  actor: Actor,
  deps: ShareLinksServiceDeps = {},
): Promise<ShareLinkSummary[]> {
  const { shareLinksRepo, now } = resolveDeps(deps);
  const records = await shareLinksRepo.listForAthlete(actor.athleteId);
  const currentTime = now();
  return records.map((record) => ({
    id: record.id,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    fields: record.fields,
    activityCount: record.activityIds.length,
    status: statusOf(record, currentTime),
  }));
}

/**
 * Revoke a share link immediately. Only the owning actor may revoke their
 * own share; an id that does not exist, or that belongs to a different
 * athlete, is rejected the same way (`ShareLinkNotFoundError`), so this can
 * never be used to probe whether a given id belongs to someone else.
 */
export async function revokeShareLinkForActor(
  actor: Actor,
  shareId: string,
  deps: ShareLinksServiceDeps = {},
): Promise<void> {
  const { shareLinksRepo, now } = resolveDeps(deps);
  const revoked = await shareLinksRepo.revoke(actor.athleteId, shareId, now());
  if (!revoked) {
    throw new ShareLinkNotFoundError();
  }
}

export type SharedView = {
  createdAt: Date;
  expiresAt: Date;
  fields: ShareLinkFieldOptions;
  activities: SharedActivityDTO[];
};

/**
 * Resolve a capability token to the data it discloses. This is the only
 * entry point here that does not take an `Actor` - the token itself is the
 * credential (docs/strava-data-policy.md §5). Every invalidation condition
 * from issue #132's acceptance criteria is enforced here, in order: unknown/
 * malformed token, revoked share, expired share, deauthorized athlete, and
 * finally - per activity - deletion or lost visibility. A deleted or
 * now-private activity is silently dropped from the result rather than
 * failing the whole share: the share's explicit subset can shrink over time
 * without the remaining, still-valid activities becoming unreachable.
 */
export async function getShareView(
  rawToken: string,
  deps: ShareLinksServiceDeps = {},
): Promise<SharedView> {
  const { shareLinksRepo, activitiesRepo, now } = resolveDeps(deps);

  if (!rawToken) {
    throw new ShareLinkUnavailableError();
  }

  const record = await shareLinksRepo.findByTokenHash(hashShareToken(rawToken));
  if (!record) {
    throw new ShareLinkUnavailableError();
  }
  if (record.revokedAt) {
    throw new ShareLinkUnavailableError();
  }

  const currentTime = now();
  if (record.expiresAt.getTime() <= currentTime.getTime()) {
    throw new ShareLinkUnavailableError();
  }

  if (await shareLinksRepo.isAthleteRevoked(record.athleteId)) {
    throw new ShareLinkUnavailableError();
  }

  const activityRows =
    record.activityIds.length === 0
      ? []
      : await activitiesRepo.findManyByIds(record.activityIds);
  const selected = new Set(record.activityIds);
  const visible = activityRows.filter(
    (activity: Activity) =>
      selected.has(activity.id) &&
      activity.athlete === record.athleteId &&
      !activity.private,
  );

  return {
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    fields: record.fields,
    activities: visible.map((activity) => toSharedActivityDTO(activity, record.fields)),
  };
}
