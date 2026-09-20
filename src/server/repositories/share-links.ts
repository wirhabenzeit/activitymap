import 'server-only';

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import {
  accounts,
  shareLinkActivities,
  shareLinks,
  users,
  type ShareLink,
} from '~/server/db/schema';
import type { ShareLinkFieldOptions } from '~/lib/sharing/fields';

type DrizzleDb = typeof defaultDb;

export type ShareLinkRecord = {
  id: string;
  athleteId: number;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  fields: ShareLinkFieldOptions;
  activityIds: number[];
};

export type NewShareLink = {
  athleteId: number;
  tokenHash: string;
  expiresAt: Date;
  fields: ShareLinkFieldOptions;
  activityIds: number[];
};

function toRecord(row: ShareLink, activityIds: number[]): ShareLinkRecord {
  return {
    id: row.id,
    athleteId: row.athleteId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    fields: row.fields,
    activityIds,
  };
}

/**
 * Repository boundary for `share_links`/`share_link_activities` (issue
 * #132). Kept separate from `~/server/application/share-links.ts` for the
 * same reason every other repository in this codebase is - see
 * `~/server/repositories/activities.ts` - so the authorization/expiry/
 * revocation/field-minimization tests can run against an in-memory fake
 * instead of a real Postgres connection, which this sandbox does not have.
 */
export interface ShareLinksRepository {
  create(input: NewShareLink): Promise<ShareLinkRecord>;
  /** Looks up a share by its *hashed* token, regardless of expiry/revocation status - the caller decides what to do with that. */
  findByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null>;
  /** Every share the athlete owns (any status), newest first. */
  listForAthlete(athleteId: number): Promise<ShareLinkRecord[]>;
  /**
   * Atomically revokes a share, but only if `athleteId` owns it and it is
   * not already revoked - `WHERE id = ... AND athlete_id = ... AND
   * revoked_at IS NULL RETURNING *`. Returns `null` for "no such share",
   * "not yours", and "already revoked" alike, so a caller cannot use the
   * result to distinguish those cases.
   */
  revoke(athleteId: number, shareId: string, now: Date): Promise<ShareLinkRecord | null>;
  /** Whether the athlete's Strava connection is currently revoked (`accounts.revokedAt` is set). */
  isAthleteRevoked(athleteId: number): Promise<boolean>;
}

export function createShareLinksRepository(
  database: DrizzleDb = defaultDb,
): ShareLinksRepository {
  return {
    async create(input) {
      return database.transaction(async (tx) => {
        const [saved] = await tx
          .insert(shareLinks)
          .values({
            athleteId: input.athleteId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            fields: input.fields,
          })
          .returning();
        if (!saved) {
          throw new Error('Failed to create share link');
        }

        if (input.activityIds.length > 0) {
          await tx.insert(shareLinkActivities).values(
            input.activityIds.map((activityId) => ({
              shareId: saved.id,
              activityId,
            })),
          );
        }

        return toRecord(saved, input.activityIds);
      });
    },

    async findByTokenHash(tokenHash) {
      const [row] = await database
        .select()
        .from(shareLinks)
        .where(eq(shareLinks.tokenHash, tokenHash));
      if (!row) return null;

      const activityRows = await database
        .select({ activityId: shareLinkActivities.activityId })
        .from(shareLinkActivities)
        .where(eq(shareLinkActivities.shareId, row.id));

      return toRecord(
        row,
        activityRows.map((r) => r.activityId),
      );
    },

    async listForAthlete(athleteId) {
      const rows = await database
        .select()
        .from(shareLinks)
        .where(eq(shareLinks.athleteId, athleteId))
        .orderBy(desc(shareLinks.createdAt));
      if (rows.length === 0) return [];

      const activityRows = await database
        .select({
          shareId: shareLinkActivities.shareId,
          activityId: shareLinkActivities.activityId,
        })
        .from(shareLinkActivities)
        .where(
          inArray(
            shareLinkActivities.shareId,
            rows.map((row) => row.id),
          ),
        );

      const byShare = new Map<string, number[]>();
      for (const { shareId, activityId } of activityRows) {
        const list = byShare.get(shareId) ?? [];
        list.push(activityId);
        byShare.set(shareId, list);
      }

      return rows.map((row) => toRecord(row, byShare.get(row.id) ?? []));
    },

    async revoke(athleteId, shareId, now) {
      const [revoked] = await database
        .update(shareLinks)
        .set({ revokedAt: now })
        .where(
          and(
            eq(shareLinks.id, shareId),
            eq(shareLinks.athleteId, athleteId),
            isNull(shareLinks.revokedAt),
          ),
        )
        .returning();
      if (!revoked) return null;

      const activityRows = await database
        .select({ activityId: shareLinkActivities.activityId })
        .from(shareLinkActivities)
        .where(eq(shareLinkActivities.shareId, revoked.id));

      return toRecord(
        revoked,
        activityRows.map((r) => r.activityId),
      );
    },

    async isAthleteRevoked(athleteId) {
      const [row] = await database
        .select({ revokedAt: accounts.revokedAt })
        .from(users)
        .innerJoin(accounts, eq(accounts.userId, users.id))
        .where(
          and(eq(users.athlete_id, athleteId), eq(accounts.providerId, 'strava')),
        );
      return Boolean(row?.revokedAt);
    },
  };
}

/** Default, database-backed repository used by application services. */
export const shareLinksRepository = createShareLinksRepository();
