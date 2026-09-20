'use server';

import { headers } from 'next/headers';

import { requireActor } from '~/server/auth/actor';
import {
  createShareLinkForActor,
  listShareLinksForActor,
  revokeShareLinkForActor,
  type ShareLinkStatus,
} from '~/server/application/share-links';
import type { ShareLinkFieldOptions } from '~/lib/sharing/fields';

/**
 * Thin `'use server'` adapters over `~/server/application/share-links.ts`,
 * matching the pattern already used for activities in
 * `~/server/db/actions.ts`: each action resolves the caller's `Actor` from
 * the current request and never trusts a client-supplied athlete id.
 *
 * This is a deliberately web-app-only, unversioned surface - not
 * `/api/v1/...` - per issue #132/docs/strava-data-policy.md §5 ("Do not add
 * a `/api/v1` sharing endpoint as part of the native API's initial scope").
 * The recipient-facing view (`~/app/share/[token]/page.tsx`) does not use a
 * Server Action at all; it calls `getShareView` directly from the page's
 * server component, since a Server Action would still require a client
 * round trip for a page that can be rendered entirely on the server.
 */

export type CreateShareLinkFormInput = {
  activityIds: number[];
  expiresInMs: number;
  fields: ShareLinkFieldOptions;
};

export type CreateShareLinkResult = {
  id: string;
  /** The plaintext capability token - shown to the creator exactly once by the caller. */
  token: string;
  createdAt: string;
  expiresAt: string;
  fields: ShareLinkFieldOptions;
  activityIds: number[];
};

export async function createShareLink(
  input: CreateShareLinkFormInput,
): Promise<CreateShareLinkResult> {
  const actor = await requireActor(await headers());
  const created = await createShareLinkForActor(actor, input);
  return {
    id: created.id,
    token: created.token,
    createdAt: created.createdAt.toISOString(),
    expiresAt: created.expiresAt.toISOString(),
    fields: created.fields,
    activityIds: created.activityIds,
  };
}

export type ShareLinkSummaryDTO = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  fields: ShareLinkFieldOptions;
  activityCount: number;
  status: ShareLinkStatus;
};

export async function listMyShareLinks(): Promise<ShareLinkSummaryDTO[]> {
  const actor = await requireActor(await headers());
  const summaries = await listShareLinksForActor(actor);
  return summaries.map((summary) => ({
    id: summary.id,
    createdAt: summary.createdAt.toISOString(),
    expiresAt: summary.expiresAt.toISOString(),
    revokedAt: summary.revokedAt ? summary.revokedAt.toISOString() : null,
    fields: summary.fields,
    activityCount: summary.activityCount,
    status: summary.status,
  }));
}

export async function revokeShareLink(shareId: string): Promise<void> {
  const actor = await requireActor(await headers());
  await revokeShareLinkForActor(actor, shareId);
}
