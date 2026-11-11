import 'server-only';

import type { SharedActivityDTO } from '~/contracts/share/activity';
import type { ShareLinkFieldOptions } from '~/lib/sharing/fields';
import type { Actor } from '~/server/auth/actor';
import { findStravaAccountInternal } from '~/server/auth/users';
import { generateShareToken, hashShareToken } from '~/server/sharing/tokens';
import {
  type CreateShareLinkInput,
  createShareLinkInputSchema,
} from '~/server/sharing/validators';
import {
  type ConvexShareLinks,
  convexShareLinks,
  convexShareView,
} from '~/server/sync/convex-shares';

/**
 * Private, scoped, expiring share links. A link names the activities it
 * shows and the fields it reveals; the page behind it is read with the
 * link's token alone. Links and the shared view live in the library
 * (`backend/convex/shares.ts`); only the hash of a token is ever stored.
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

export class ShareLinkUnavailableError extends Error {
  constructor(message = 'This share link is no longer available.') {
    super(message);
    this.name = 'ShareLinkUnavailableError';
  }
}

export type ShareLinksServiceDeps = {
  now?: () => Date;
  generateToken?: () => string;
  links?: (actor: Actor) => ConvexShareLinks;
  view?: typeof convexShareView;
  /** Whether the athlete withdrew provider access: their links stop then. */
  isAthleteRevoked?: (athleteId: number) => Promise<boolean>;
};

function resolveDeps(deps: ShareLinksServiceDeps) {
  return {
    now: deps.now ?? (() => new Date()),
    generateToken: deps.generateToken ?? generateShareToken,
    links: deps.links ?? convexShareLinks,
    view: deps.view ?? convexShareView,
    isAthleteRevoked:
      deps.isAthleteRevoked ??
      (async (athleteId: number) =>
        Boolean(
          (await findStravaAccountInternal({ accountId: String(athleteId) }))
            ?.revokedAt,
        )),
  };
}

export type CreatedShareLink = {
  id: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  fields: ShareLinkFieldOptions;
  activityIds: number[];
};

/** Create a link to some of the actor's own activities. The token is
 * returned once and cannot be read again. */
export async function createShareLinkForActor(
  actor: Actor,
  input: CreateShareLinkInput,
  deps: ShareLinksServiceDeps = {},
): Promise<CreatedShareLink> {
  const { now, generateToken, links } = resolveDeps(deps);
  const parsed = createShareLinkInputSchema.parse(input);
  const token = generateToken();
  const link = await links(actor).create({
    tokenHash: hashShareToken(token),
    expiresAt: now().getTime() + parsed.expiresInMs,
    fields: parsed.fields,
    activityIds: parsed.activityIds.map(String),
  });
  if (!link)
    throw new ForbiddenError(
      'Cannot create a share link for activities that do not belong to you.',
    );
  return {
    id: link.id,
    token,
    createdAt: new Date(link.createdAt),
    expiresAt: new Date(link.expiresAt),
    fields: link.fields,
    activityIds: link.activityIds.map(Number),
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

/** The actor's links, newest first. */
export async function listShareLinksForActor(
  actor: Actor,
  deps: ShareLinksServiceDeps = {},
): Promise<ShareLinkSummary[]> {
  const { now, links } = resolveDeps(deps);
  const currentTime = now().getTime();
  return (await links(actor).list())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((link) => ({
      id: link.id,
      createdAt: new Date(link.createdAt),
      expiresAt: new Date(link.expiresAt),
      revokedAt: link.revokedAt === null ? null : new Date(link.revokedAt),
      fields: link.fields,
      activityCount: link.activityIds.length,
      status:
        link.revokedAt !== null
          ? 'revoked'
          : link.expiresAt <= currentTime
            ? 'expired'
            : 'active',
    }));
}

export async function revokeShareLinkForActor(
  actor: Actor,
  shareId: string,
  deps: ShareLinksServiceDeps = {},
): Promise<void> {
  const { links } = resolveDeps(deps);
  if (!(await links(actor).revoke(shareId))) throw new ShareLinkNotFoundError();
}

export type SharedView = {
  createdAt: Date;
  expiresAt: Date;
  fields: ShareLinkFieldOptions;
  activities: SharedActivityDTO[];
};

/**
 * What a link shows. Every way a link can fail (unknown, expired, revoked,
 * or its athlete withdrew provider access) is the same answer, so a guess
 * learns nothing.
 */
export async function getShareView(
  rawToken: string,
  deps: ShareLinksServiceDeps = {},
): Promise<SharedView> {
  const { view, isAthleteRevoked } = resolveDeps(deps);
  if (!rawToken) throw new ShareLinkUnavailableError();
  const shared = await view(hashShareToken(rawToken));
  if (!shared || (await isAthleteRevoked(Number(shared.athleteId))))
    throw new ShareLinkUnavailableError();
  return {
    createdAt: new Date(shared.createdAt),
    expiresAt: new Date(shared.expiresAt),
    fields: shared.fields,
    activities: shared.activities,
  };
}
