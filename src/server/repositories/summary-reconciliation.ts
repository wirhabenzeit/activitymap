import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import {
  accounts,
  activities,
  activityDeletions,
  photoDeletions,
  photos,
  stravaSummaryReconciliations,
  users,
  type Activity,
  type StravaSummaryReconciliation,
} from '~/server/db/schema';
import { createChangesRepository } from '~/server/repositories/changes';
import { transformStravaActivity } from '~/server/strava/transforms';
import type { StravaActivity } from '~/server/strava/types';

type DrizzleDb = typeof defaultDb;

export type SummaryReconciliationCandidate = {
  userId: string;
  athleteId: number;
};

export type SummaryReconciliationClaim = SummaryReconciliationCandidate &
  Pick<
    StravaSummaryReconciliation,
    | 'scanStartedAt'
    | 'scanBefore'
    | 'nextPage'
    | 'phase'
    | 'candidateAfterId'
    | 'leaseToken'
    | 'leaseExpiresAt'
  > & { leaseToken: string; leaseExpiresAt: Date };

export interface SummaryReconciliationRepository {
  listDue(
    limit: number,
    dueBefore: Date,
    now: Date,
  ): Promise<SummaryReconciliationCandidate[]>;
  claim(
    candidate: SummaryReconciliationCandidate,
    dueBefore: Date,
    now: Date,
    leaseMs: number,
  ): Promise<SummaryReconciliationClaim | null>;
  applySummaryPage(
    claim: SummaryReconciliationClaim,
    summaries: StravaActivity[],
    terminal: boolean,
  ): Promise<SummaryReconciliationClaim>;
  listMissingCandidates(
    claim: SummaryReconciliationClaim,
    limit: number,
  ): Promise<number[]>;
  confirmPresent(
    claim: SummaryReconciliationClaim,
    activity: StravaActivity,
    confirmedAt: Date,
  ): Promise<SummaryReconciliationClaim>;
  confirmMissing(
    claim: SummaryReconciliationClaim,
    activityId: number,
    confirmedAt: Date,
  ): Promise<SummaryReconciliationClaim>;
  complete(claim: SummaryReconciliationClaim): Promise<boolean>;
  release(claim: SummaryReconciliationClaim, now: Date): Promise<void>;
  lastCompletedAt(athleteId: number): Promise<Date | null>;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

const GEOMETRY_FIELDS = [
  'distance',
  'moving_time',
  'elapsed_time',
  'start_date',
  'start_date_local',
  'timezone',
  'start_latlng',
  'end_latlng',
  'map_id',
  'map_summary_polyline',
  'map_bbox',
] as const satisfies readonly (keyof Activity)[];

const PHOTO_FIELDS = [
  'photo_count',
  'total_photo_count',
] as const satisfies readonly (keyof Activity)[];

function changed(
  existing: Activity,
  incoming: Activity,
  fields: readonly (keyof Activity)[],
): boolean {
  return fields.some((field) => !valuesEqual(existing[field], incoming[field]));
}

function effectiveGeometryState(activity: Activity) {
  return activity.geometryState ?? (activity.is_complete ? 'detailed' : 'summary');
}

/**
 * Merge one Strava SummaryActivity into a stored row without overwriting
 * detail-only fields. Geometry and photo invalidation are deliberately
 * independent so an engagement-only change never discards a detailed route.
 */
export function mergeSummaryActivity(
  existing: Activity | undefined,
  summary: StravaActivity,
  athleteId: number,
  observedAt: Date,
): Activity {
  const incoming = {
    ...transformStravaActivity(summary, false, { observedAt }),
    athlete: athleteId,
  } satisfies Activity;

  if (!existing) return incoming;

  const geometryChanged = changed(existing, incoming, GEOMETRY_FIELDS);
  const photosChanged = changed(existing, incoming, PHOTO_FIELDS);
  const priorGeometryState = effectiveGeometryState(existing);

  return {
    ...existing,
    // Fields present on Strava's summary representation. Detail-only values
    // (description, detailed polyline, heart-rate/calorie detail, and
    // detailed elevation/power values) intentionally remain from `existing`.
    name: incoming.name,
    distance: incoming.distance,
    moving_time: incoming.moving_time,
    elapsed_time: incoming.elapsed_time,
    total_elevation_gain: incoming.total_elevation_gain,
    sport_type: incoming.sport_type,
    start_date: incoming.start_date,
    start_date_local: incoming.start_date_local,
    timezone: incoming.timezone,
    start_latlng: incoming.start_latlng,
    end_latlng: incoming.end_latlng,
    achievement_count: incoming.achievement_count,
    kudos_count: incoming.kudos_count,
    comment_count: incoming.comment_count,
    athlete_count: incoming.athlete_count,
    photo_count: incoming.photo_count,
    total_photo_count: incoming.total_photo_count,
    map_id: incoming.map_id,
    map_summary_polyline: incoming.map_summary_polyline,
    map_bbox: incoming.map_bbox,
    trainer: incoming.trainer,
    commute: incoming.commute,
    manual: incoming.manual,
    private: incoming.private,
    flagged: incoming.flagged,
    workout_type: incoming.workout_type,
    upload_id: incoming.upload_id,
    average_speed: incoming.average_speed,
    max_speed: incoming.max_speed,
    pr_count: incoming.pr_count,
    has_kudoed: incoming.has_kudoed,
    hide_from_home: incoming.hide_from_home,
    gear_id: incoming.gear_id,
    device_watts: incoming.device_watts,
    average_watts: incoming.average_watts,
    kilojoules: incoming.kilojoules,
    last_updated: observedAt,
    geometryState: geometryChanged
      ? priorGeometryState === 'summary'
        ? 'summary'
        : 'refresh_required'
      : priorGeometryState,
    photosState: photosChanged
      ? 'refresh_required'
      : (existing.photosState ?? incoming.photosState),
    lastSummarySeenAt: observedAt,
    lastDetailedFetchedAt: existing.lastDetailedFetchedAt,
    // Keep the legacy web signal coherent until #126 removes its consumers.
    is_complete: geometryChanged ? false : existing.is_complete,
  };
}

function mergeConfirmedDetail(
  existing: Activity | undefined,
  detail: StravaActivity,
  athleteId: number,
  scanStartedAt: Date,
  confirmedAt: Date,
): Activity {
  const incoming = {
    ...transformStravaActivity(detail, true, { observedAt: confirmedAt }),
    athlete: athleteId,
  } satisfies Activity;
  const photosChanged = existing
    ? changed(existing, incoming, PHOTO_FIELDS)
    : false;

  return {
    ...incoming,
    photosState: photosChanged
      ? 'refresh_required'
      : (existing?.photosState ?? incoming.photosState),
    lastSummarySeenAt: scanStartedAt,
  };
}

function summaryConflictSet() {
  return {
    name: sql`excluded.name`,
    distance: sql`excluded.distance`,
    moving_time: sql`excluded.moving_time`,
    elapsed_time: sql`excluded.elapsed_time`,
    total_elevation_gain: sql`excluded.total_elevation_gain`,
    sport_type: sql`excluded.sport_type`,
    start_date: sql`excluded.start_date`,
    start_date_local: sql`excluded.start_date_local`,
    timezone: sql`excluded.timezone`,
    start_latlng: sql`excluded.start_latlng`,
    end_latlng: sql`excluded.end_latlng`,
    achievement_count: sql`excluded.achievement_count`,
    kudos_count: sql`excluded.kudos_count`,
    comment_count: sql`excluded.comment_count`,
    athlete_count: sql`excluded.athlete_count`,
    photo_count: sql`excluded.photo_count`,
    total_photo_count: sql`excluded.total_photo_count`,
    map_id: sql`excluded.map_id`,
    map_summary_polyline: sql`excluded.map_summary_polyline`,
    map_bbox: sql`excluded.map_bbox`,
    trainer: sql`excluded.trainer`,
    commute: sql`excluded.commute`,
    manual: sql`excluded.manual`,
    private: sql`excluded.private`,
    flagged: sql`excluded.flagged`,
    workout_type: sql`excluded.workout_type`,
    upload_id: sql`excluded.upload_id`,
    average_speed: sql`excluded.average_speed`,
    max_speed: sql`excluded.max_speed`,
    pr_count: sql`excluded.pr_count`,
    has_kudoed: sql`excluded.has_kudoed`,
    hide_from_home: sql`excluded.hide_from_home`,
    gear_id: sql`excluded.gear_id`,
    device_watts: sql`excluded.device_watts`,
    average_watts: sql`excluded.average_watts`,
    kilojoules: sql`excluded.kilojoules`,
    last_updated: sql`excluded.last_updated`,
    geometryState: sql`excluded.geometry_state`,
    photosState: sql`excluded.photos_state`,
    lastSummarySeenAt: sql`excluded.last_summary_seen_at`,
    lastDetailedFetchedAt: sql`excluded.last_detailed_fetched_at`,
    is_complete: sql`excluded.is_complete`,
  };
}

export function createSummaryReconciliationRepository(
  database: DrizzleDb = defaultDb,
): SummaryReconciliationRepository {
  const changesRepo = createChangesRepository(database);

  async function lockClaim(
    tx: Parameters<Parameters<DrizzleDb['transaction']>[0]>[0],
    claim: SummaryReconciliationClaim,
    phase?: StravaSummaryReconciliation['phase'],
  ) {
    const conditions = [
      eq(stravaSummaryReconciliations.athleteId, claim.athleteId),
      eq(stravaSummaryReconciliations.leaseToken, claim.leaseToken),
    ];
    if (phase) conditions.push(eq(stravaSummaryReconciliations.phase, phase));
    const [state] = await tx
      .select()
      .from(stravaSummaryReconciliations)
      .where(and(...conditions))
      .for('update');
    if (!state) throw new Error('Summary reconciliation lease is no longer active');
    return state;
  }

  function withState(
    claim: SummaryReconciliationClaim,
    state: StravaSummaryReconciliation,
  ): SummaryReconciliationClaim {
    if (!state.leaseToken || !state.leaseExpiresAt) {
      throw new Error('Summary reconciliation state is not leased');
    }
    return {
      ...claim,
      scanStartedAt: state.scanStartedAt,
      scanBefore: state.scanBefore,
      nextPage: state.nextPage,
      phase: state.phase,
      candidateAfterId: state.candidateAfterId,
      leaseToken: state.leaseToken,
      leaseExpiresAt: state.leaseExpiresAt,
    };
  }

  return {
    async listDue(limit, dueBefore, now) {
      const rows = await database
        .select({
          userId: users.id,
          athleteId: users.athlete_id,
        })
        .from(users)
        .innerJoin(
          accounts,
          and(eq(accounts.userId, users.id), eq(accounts.providerId, 'strava')),
        )
        .leftJoin(
          stravaSummaryReconciliations,
          eq(stravaSummaryReconciliations.athleteId, users.athlete_id),
        )
        .where(
          and(
            isNotNull(users.athlete_id),
            isNull(accounts.revokedAt),
            or(
              isNotNull(accounts.accessToken),
              isNotNull(accounts.access_token),
              isNotNull(accounts.refreshToken),
              isNotNull(accounts.refresh_token),
            ),
            or(
              isNotNull(stravaSummaryReconciliations.athleteId),
              isNull(users.lastSummaryReconciledAt),
              lte(users.lastSummaryReconciledAt, dueBefore),
            ),
            or(
              isNull(stravaSummaryReconciliations.leaseExpiresAt),
              lte(stravaSummaryReconciliations.leaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(
          sql`CASE WHEN ${stravaSummaryReconciliations.athleteId} IS NULL THEN 1 ELSE 0 END`,
          asc(stravaSummaryReconciliations.updatedAt),
          asc(users.lastSummaryReconciledAt),
        )
        .limit(limit * 4);

      const seen = new Set<number>();
      const candidates: SummaryReconciliationCandidate[] = [];
      for (const row of rows) {
        if (row.athleteId === null || seen.has(row.athleteId)) continue;
        seen.add(row.athleteId);
        candidates.push({ userId: row.userId, athleteId: row.athleteId });
        if (candidates.length === limit) break;
      }
      return candidates;
    },

    async claim(candidate, dueBefore, now, leaseMs) {
      return database.transaction(async (tx) => {
        const [current] = await tx
          .select({
            lastCompletedAt: users.lastSummaryReconciledAt,
            revokedAt: accounts.revokedAt,
            accessToken: accounts.accessToken,
            legacyAccessToken: accounts.access_token,
            refreshToken: accounts.refreshToken,
            legacyRefreshToken: accounts.refresh_token,
          })
          .from(users)
          .innerJoin(
            accounts,
            and(
              eq(accounts.userId, users.id),
              eq(accounts.providerId, 'strava'),
            ),
          )
          .where(
            and(
              eq(users.id, candidate.userId),
              eq(users.athlete_id, candidate.athleteId),
            ),
          )
          .limit(1);

        if (
          !current ||
          current.revokedAt ||
          (!current.accessToken &&
            !current.legacyAccessToken &&
            !current.refreshToken &&
            !current.legacyRefreshToken)
        ) {
          return null;
        }

        const [existingState] = await tx
          .select({ athleteId: stravaSummaryReconciliations.athleteId })
          .from(stravaSummaryReconciliations)
          .where(eq(stravaSummaryReconciliations.athleteId, candidate.athleteId));
        if (
          !existingState &&
          current.lastCompletedAt &&
          current.lastCompletedAt > dueBefore
        ) {
          return null;
        }

        await tx
          .insert(stravaSummaryReconciliations)
          .values({
            athleteId: candidate.athleteId,
            scanStartedAt: now,
            // Strava's `before` is exclusive. Advancing one second includes
            // activities created in the same second the scan is claimed.
            scanBefore: Math.floor(now.getTime() / 1000) + 1,
            nextPage: 1,
          })
          .onConflictDoNothing();

        const leaseToken = randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + leaseMs);
        const [state] = await tx
          .update(stravaSummaryReconciliations)
          .set({ leaseToken, leaseExpiresAt, updatedAt: now })
          .where(
            and(
              eq(stravaSummaryReconciliations.athleteId, candidate.athleteId),
              or(
                isNull(stravaSummaryReconciliations.leaseExpiresAt),
                lte(stravaSummaryReconciliations.leaseExpiresAt, now),
              ),
            ),
          )
          .returning();
        if (!state?.leaseToken || !state.leaseExpiresAt) return null;
        return withState({ ...candidate, ...state, leaseToken, leaseExpiresAt }, state);
      });
    },

    async applySummaryPage(claim, summaries, terminal) {
      if (summaries.some((summary) => summary.athlete.id !== claim.athleteId)) {
        throw new Error('Strava summary page contained another athlete');
      }

      return database.transaction(async (tx) => {
        const state = await lockClaim(tx, claim, 'scanning');
        if (state.nextPage !== claim.nextPage) {
          throw new Error('Summary reconciliation page was already advanced');
        }

        if (summaries.length > 0) {
          const ids = summaries.map((summary) => summary.id);
          const existingRows = await tx
            .select()
            .from(activities)
            .where(inArray(activities.id, ids))
            .for('update');
          const existingById = new Map(existingRows.map((row) => [row.id, row]));
          for (const row of existingRows) {
            if (row.athlete !== claim.athleteId) {
              throw new Error(`Activity ${row.id} belongs to another athlete`);
            }
          }

          const merged = summaries.map((summary) =>
            mergeSummaryActivity(
              existingById.get(summary.id),
              summary,
              claim.athleteId,
              claim.scanStartedAt,
            ),
          );
          await tx
            .insert(activities)
            .values(merged)
            .onConflictDoUpdate({
              target: activities.id,
              set: summaryConflictSet(),
            });
          await changesRepo.record(
            merged.map((activity) => ({
              athleteId: claim.athleteId,
              entityType: 'activity' as const,
              entityId: activity.id,
              operation: 'upsert' as const,
            })),
            tx,
          );
        }

        const [nextState] = await tx
          .update(stravaSummaryReconciliations)
          .set(
            terminal
              ? {
                  phase: 'confirming',
                  candidateAfterId: null,
                  updatedAt: new Date(),
                }
              : { nextPage: state.nextPage + 1, updatedAt: new Date() },
          )
          .where(
            and(
              eq(stravaSummaryReconciliations.athleteId, claim.athleteId),
              eq(stravaSummaryReconciliations.leaseToken, claim.leaseToken),
              eq(stravaSummaryReconciliations.nextPage, state.nextPage),
            ),
          )
          .returning();
        if (!nextState) throw new Error('Failed to checkpoint summary page');
        return withState(claim, nextState);
      });
    },

    async listMissingCandidates(claim, limit) {
      const [state] = await database
        .select()
        .from(stravaSummaryReconciliations)
        .where(
          and(
            eq(stravaSummaryReconciliations.athleteId, claim.athleteId),
            eq(stravaSummaryReconciliations.leaseToken, claim.leaseToken),
            eq(stravaSummaryReconciliations.phase, 'confirming'),
          ),
        );
      if (!state) throw new Error('Summary reconciliation lease is no longer active');

      return database
        .select({ id: activities.id })
        .from(activities)
        .where(
          and(
            eq(activities.athlete, claim.athleteId),
            gt(activities.id, state.candidateAfterId ?? 0),
            or(
              isNull(activities.lastSummarySeenAt),
              lt(activities.lastSummarySeenAt, state.scanStartedAt),
            ),
          ),
        )
        .orderBy(asc(activities.id))
        .limit(limit)
        .then((rows) => rows.map((row) => row.id));
    },

    async confirmPresent(claim, detail, confirmedAt) {
      if (detail.athlete.id !== claim.athleteId) {
        throw new Error('Confirmed activity belongs to another athlete');
      }
      return database.transaction(async (tx) => {
        await lockClaim(tx, claim, 'confirming');
        const [existing] = await tx
          .select()
          .from(activities)
          .where(eq(activities.id, detail.id))
          .for('update');
        if (existing && existing.athlete !== claim.athleteId) {
          throw new Error(`Activity ${detail.id} belongs to another athlete`);
        }
        const merged = mergeConfirmedDetail(
          existing,
          detail,
          claim.athleteId,
          claim.scanStartedAt,
          confirmedAt,
        );
        await tx
          .insert(activities)
          .values(merged)
          .onConflictDoUpdate({ target: activities.id, set: merged });
        await changesRepo.record(
          [
            {
              athleteId: claim.athleteId,
              entityType: 'activity',
              entityId: detail.id,
              operation: 'upsert',
            },
          ],
          tx,
        );
        const [nextState] = await tx
          .update(stravaSummaryReconciliations)
          .set({ candidateAfterId: detail.id, updatedAt: confirmedAt })
          .where(
            and(
              eq(stravaSummaryReconciliations.athleteId, claim.athleteId),
              eq(stravaSummaryReconciliations.leaseToken, claim.leaseToken),
            ),
          )
          .returning();
        if (!nextState) throw new Error('Failed to checkpoint confirmation');
        return withState(claim, nextState);
      });
    },

    async confirmMissing(claim, activityId, confirmedAt) {
      return database.transaction(async (tx) => {
        await lockClaim(tx, claim, 'confirming');
        const cascadedPhotos = await tx
          .select({ id: photos.unique_id, activityId: photos.activity_id })
          .from(photos)
          .where(eq(photos.activity_id, activityId));
        await tx
          .delete(activities)
          .where(
            and(
              eq(activities.id, activityId),
              eq(activities.athlete, claim.athleteId),
            ),
          );
        await tx
          .insert(activityDeletions)
          .values({
            athlete_id: claim.athleteId,
            activity_id: activityId,
            deleted_at: confirmedAt,
          })
          .onConflictDoUpdate({
            target: [activityDeletions.athlete_id, activityDeletions.activity_id],
            set: { deleted_at: confirmedAt },
          });
        if (cascadedPhotos.length > 0) {
          await tx
            .insert(photoDeletions)
            .values(
              cascadedPhotos.map((photo) => ({
                athlete_id: claim.athleteId,
                photo_id: photo.id,
                activity_id: photo.activityId,
                deleted_at: confirmedAt,
              })),
            )
            .onConflictDoUpdate({
              target: [photoDeletions.athlete_id, photoDeletions.photo_id],
              set: {
                activity_id: sql`excluded.activity_id`,
                deleted_at: confirmedAt,
              },
            });
        }
        await changesRepo.record(
          [
            {
              athleteId: claim.athleteId,
              entityType: 'activity',
              entityId: activityId,
              operation: 'delete',
            },
            ...cascadedPhotos.map((photo) => ({
              athleteId: claim.athleteId,
              entityType: 'photo' as const,
              entityId: photo.id,
              operation: 'delete' as const,
            })),
          ],
          tx,
        );
        const [nextState] = await tx
          .update(stravaSummaryReconciliations)
          .set({ candidateAfterId: activityId, updatedAt: confirmedAt })
          .where(
            and(
              eq(stravaSummaryReconciliations.athleteId, claim.athleteId),
              eq(stravaSummaryReconciliations.leaseToken, claim.leaseToken),
            ),
          )
          .returning();
        if (!nextState) throw new Error('Failed to checkpoint missing activity');
        return withState(claim, nextState);
      });
    },

    async complete(claim) {
      return database.transaction(async (tx) => {
        const state = await lockClaim(tx, claim, 'confirming');
        const [remaining] = await tx
          .select({ id: activities.id })
          .from(activities)
          .where(
            and(
              eq(activities.athlete, claim.athleteId),
              gt(activities.id, state.candidateAfterId ?? 0),
              or(
                isNull(activities.lastSummarySeenAt),
                lt(activities.lastSummarySeenAt, state.scanStartedAt),
              ),
            ),
          )
          .limit(1);
        if (remaining) return false;

        await tx
          .update(users)
          .set({
            lastSummaryReconciledAt: state.scanStartedAt,
            updatedAt: new Date(),
          })
          .where(eq(users.athlete_id, claim.athleteId));
        const deleted = await tx
          .delete(stravaSummaryReconciliations)
          .where(
            and(
              eq(stravaSummaryReconciliations.athleteId, claim.athleteId),
              eq(stravaSummaryReconciliations.leaseToken, claim.leaseToken),
            ),
          )
          .returning({ athleteId: stravaSummaryReconciliations.athleteId });
        return deleted.length === 1;
      });
    },

    async release(claim, now) {
      await database
        .update(stravaSummaryReconciliations)
        .set({ leaseToken: null, leaseExpiresAt: null, updatedAt: now })
        .where(
          and(
            eq(stravaSummaryReconciliations.athleteId, claim.athleteId),
            eq(stravaSummaryReconciliations.leaseToken, claim.leaseToken),
          ),
        );
    },

    async lastCompletedAt(athleteId) {
      const [row] = await database
        .select({ value: users.lastSummaryReconciledAt })
        .from(users)
        .where(eq(users.athlete_id, athleteId));
      return row?.value ?? null;
    },
  };
}

export const summaryReconciliationRepository =
  createSummaryReconciliationRepository();
