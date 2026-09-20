'use client';

/**
 * Runtime compatibility instrumentation for the #126 cutover (phase 2's
 * "compare old/new behavior and instrument compatibility usage" scope
 * line).
 *
 * There is no browser test harness or client telemetry pipeline in this
 * repository (checked: no jsdom/Vitest/Playwright devDependency, no
 * Sentry/PostHog/analytics package) to build a live A/B comparison test on
 * top of, and standing one up is out of proportion for this PR. This module
 * is the practical alternative the issue explicitly allows for: a one-time,
 * per-scope comparison between the legacy cache
 * (`~/lib/offline/db.ts`, last written by `/api/offline/*` before this
 * cutover) and the new v1 cache (`~/lib/sync/v1-store.ts`), logged to the
 * console with a stable, greppable prefix so it can be picked up by
 * whatever the deployment's log/error monitoring already captures (e.g.
 * Vercel's function/browser logs), without this repo needing to adopt a
 * telemetry SDK just for this migration.
 *
 * This is honestly a coarse signal, not a full parity harness: it compares
 * two caches that were populated by different mechanisms at different
 * times, so some divergence right after cutover is expected (the legacy
 * cache stops being updated once `~/components/providers/offline-sync.tsx`
 * switches to `runV1Sync`, while the v1 cache keeps advancing). It answers
 * the one question that matters for a safe phase 3: "did the v1 cache see
 * at least everything the legacy cache had recorded as of the cutover
 * point" — see `logSyncParityReport`.
 */

import {
  getCachedActivities as defaultGetCachedActivities,
  getCachedPhotos as defaultGetCachedPhotos,
} from '~/lib/offline/db';
import {
  getCachedActivityDTOs as defaultGetCachedActivityDTOs,
  getCachedPhotoDTOs as defaultGetCachedPhotoDTOs,
} from '~/lib/sync/v1-store';

export type SyncParityReport = {
  scope: string;
  legacyActivityCount: number;
  v1ActivityCount: number;
  legacyOnlyActivityIds: number[];
  legacyPhotoCount: number;
  v1PhotoCount: number;
  legacyOnlyPhotoIds: string[];
};

export type SyncParityDeps = {
  getCachedActivities: typeof defaultGetCachedActivities;
  getCachedActivityDTOs: typeof defaultGetCachedActivityDTOs;
  getCachedPhotos: typeof defaultGetCachedPhotos;
  getCachedPhotoDTOs: typeof defaultGetCachedPhotoDTOs;
};

const defaultDeps: SyncParityDeps = {
  getCachedActivities: defaultGetCachedActivities,
  getCachedActivityDTOs: defaultGetCachedActivityDTOs,
  getCachedPhotos: defaultGetCachedPhotos,
  getCachedPhotoDTOs: defaultGetCachedPhotoDTOs,
};

/**
 * Compares what the legacy cache holds for `scope` against what the v1
 * cache holds. Only "legacy has it, v1 doesn't" is flagged as a real gap —
 * the reverse ("v1 has it, legacy doesn't") is the *expected*, desired
 * outcome of a `/sync/changes` catch-up picking up something newer than
 * whatever the legacy cache last saw, not a compatibility problem.
 */
export async function computeSyncParityReport(
  scope: string,
  deps: SyncParityDeps = defaultDeps,
): Promise<SyncParityReport> {
  const [legacyActivities, v1Activities, legacyPhotos, v1Photos] = await Promise.all([
    deps.getCachedActivities(scope),
    deps.getCachedActivityDTOs(scope),
    deps.getCachedPhotos(scope),
    deps.getCachedPhotoDTOs(scope),
  ]);

  const v1ActivityIds = new Set(v1Activities.map((a) => Number(a.id)));
  const v1PhotoIds = new Set(v1Photos.map((p) => p.unique_id));

  return {
    scope,
    legacyActivityCount: legacyActivities.length,
    v1ActivityCount: v1Activities.length,
    legacyOnlyActivityIds: legacyActivities
      .map((a) => a.id)
      .filter((id) => !v1ActivityIds.has(id)),
    legacyPhotoCount: legacyPhotos.length,
    v1PhotoCount: v1Photos.length,
    legacyOnlyPhotoIds: legacyPhotos
      .map((p) => p.unique_id)
      .filter((id) => !v1PhotoIds.has(id)),
  };
}

const PARITY_LOG_TAG = '[sync-v1-parity]';

/** Logs `report` at `warn` if it found a gap, `info` otherwise. */
export function logSyncParityReport(report: SyncParityReport): void {
  const hasGap = report.legacyOnlyActivityIds.length > 0 || report.legacyOnlyPhotoIds.length > 0;
  const log = hasGap ? console.warn : console.info;
  log(`${PARITY_LOG_TAG} scope=${report.scope}`, {
    legacyActivityCount: report.legacyActivityCount,
    v1ActivityCount: report.v1ActivityCount,
    legacyOnlyActivityIds: report.legacyOnlyActivityIds,
    legacyPhotoCount: report.legacyPhotoCount,
    v1PhotoCount: report.v1PhotoCount,
    legacyOnlyPhotoIds: report.legacyOnlyPhotoIds,
  });
}

const PARITY_CHECKED_KEY_PREFIX = 'sync-v1-parity-checked:';

const hasLocalStorage = (): boolean => {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
};

/**
 * Runs `computeSyncParityReport`/`logSyncParityReport` for `scope` at most
 * once per browser (tracked in `localStorage`, best-effort) — this is a
 * one-time cutover check, not something worth repeating on every sync.
 * Never throws: instrumentation must not be able to break the sync it is
 * observing.
 */
export async function checkSyncParityOnce(
  scope: string,
  deps: SyncParityDeps = defaultDeps,
): Promise<void> {
  const storageKey = `${PARITY_CHECKED_KEY_PREFIX}${scope}`;
  try {
    if (hasLocalStorage() && window.localStorage.getItem(storageKey)) return;
  } catch {
    // Best-effort only; fall through and check anyway.
  }

  try {
    const report = await computeSyncParityReport(scope, deps);
    logSyncParityReport(report);
  } catch (error) {
    console.warn(`${PARITY_LOG_TAG} failed to compute parity report`, error);
  }

  try {
    if (hasLocalStorage()) window.localStorage.setItem(storageKey, new Date().toISOString());
  } catch {
    // Best-effort only.
  }
}
