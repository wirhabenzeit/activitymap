import 'server-only';

import { z } from 'zod';

import type { StravaImportDTO } from '~/contracts/v1/strava-import';
import type { Actor } from '~/server/auth/actor';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import { StravaImportError } from './strava-import';

/**
 * "Fetch from Strava" for an account Convex writes for. There is no import
 * run to start: the account's reconciliation sweep
 * (backend/convex/ingestionSweep.ts) reads the provider's activity list and
 * asks for whatever is missing or changed. The command starts that sweep
 * now, and its status is the sweep's.
 */

const sweepSchema = z
  .object({
    number: z.number(),
    phase: z.enum(['idle', 'scanning', 'confirming']),
    page: z.number(),
    scanStartedAt: z.number().nullable(),
    dueAt: z.number(),
    running: z.boolean(),
    error: z.string().nullable(),
    completedAt: z.number().nullable(),
  })
  .nullable();
type Sweep = z.infer<typeof sweepSchema>;

/** Activities per list page the sweep reads (SWEEP_PAGE_SIZE). */
const PAGE = 100;
const iso = (value: number | null) =>
  value === null ? null : new Date(value).toISOString();

export function importStatusFromSweep(
  sweep: Sweep,
  available: boolean,
): StravaImportDTO {
  const base = {
    available,
    runId: sweep ? `sweep-${sweep.number}` : null,
    reason: null,
    startedAt: iso(sweep?.scanStartedAt ?? null),
    finishedAt: null,
    retryAt: null,
    summaries: 0,
    details: 0,
    photos: 0,
  };
  if (!sweep) return { ...base, status: 'idle' };
  if (sweep.phase === 'idle')
    return sweep.completedAt === null
      ? { ...base, status: 'idle' }
      : {
          ...base,
          status: 'succeeded',
          reason: 'complete',
          finishedAt: iso(sweep.completedAt),
        };
  const summaries = sweep.phase === 'scanning' ? (sweep.page - 1) * PAGE : 0;
  // Between two runs of an unfinished sweep: waiting for its next time.
  if (sweep.error && !sweep.running)
    return {
      ...base,
      status: 'deferred',
      reason: sweep.error === 'rate_limited' ? 'rate_limit' : 'internal_error',
      retryAt: iso(sweep.dueAt),
      summaries,
    };
  return { ...base, status: 'running', summaries };
}

async function bridgeFor(actor: Actor, fetcher: typeof fetch) {
  const writer = convexWriteBridge(actor, fetcher);
  if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  const state = await writer.write<{ epoch: string } | null>({ kind: 'state' });
  if (!state) throw new Error('The owner is not provisioned in Convex');
  return { writer, epoch: state.epoch };
}

export async function readConvexImport(
  actor: Actor,
  enabled: boolean,
  fetcher: typeof fetch = fetch,
): Promise<StravaImportDTO> {
  const { writer, epoch } = await bridgeFor(actor, fetcher);
  return importStatusFromSweep(
    sweepSchema.parse(await writer.write({ kind: 'sweepStatus' }, epoch)),
    enabled,
  );
}

export async function startConvexImport(
  actor: Actor,
  enabled: boolean,
  fetcher: typeof fetch = fetch,
): Promise<{ status: StravaImportDTO; claim: null }> {
  if (!enabled)
    throw new StravaImportError(
      403,
      'external_effects_disabled',
      'Fetching from Strava is unavailable in this environment.',
    );
  const { writer, epoch } = await bridgeFor(actor, fetcher);
  const started = await writer.write<boolean>({ kind: 'sweepNow' }, epoch);
  const status = importStatusFromSweep(
    sweepSchema.parse(await writer.write({ kind: 'sweepStatus' }, epoch)),
    enabled,
  );
  // Started, and not picked up by its worker yet.
  return {
    status:
      started && status.status !== 'running'
        ? {
            ...status,
            status: 'running',
            reason: null,
            finishedAt: null,
            startedAt: new Date().toISOString(),
          }
        : status,
    claim: null,
  };
}
