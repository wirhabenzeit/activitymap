'use node';

import { createHash, randomUUID } from 'node:crypto';

import { v } from 'convex/values';

import { providerGatewayClient } from '../../src/server/provider-gateway/client';
import type {
  GatewayFailure,
  GatewayOperation,
} from '../../src/server/provider-gateway/contract';
import {
  ForeignProviderActivity,
  InvalidProviderPayload,
  activitySource,
  activitySummary,
  hasPhotos,
  photoSources,
} from '../ingestion/provider';
import {
  isMatchingVersion,
  matchPrepared,
  prepareActivity,
  readCatalogue,
} from '../matching/activity-match';
import { encodeWhole, validateRecording } from '../recording/codec';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { type ActionCtx, internalAction } from './_generated/server';
import type { IngestionStep } from './ingestion';
import {
  SUMMARIES_PER_CALL,
  SWEEP_PAGE_SIZE,
  type SweepStep,
} from './ingestionSweep';
import { prepareRecording } from './recordingWorker';

/**
 * The ingestion worker (convex/ingestion.ts): one run of one job. It holds
 * no provider credential; every provider read goes through the app's signed
 * provider gateway, which owns the tokens and the shared request budget.
 *
 * Settings (Convex environment variables):
 * - `ACTIVITYMAP_APP_ORIGIN`: the app's origin, for example
 *   https://activitymap.cc
 * - `ACTIVITYMAP_PROVIDER_GATEWAY_KEY_ID` and
 *   `ACTIVITYMAP_PROVIDER_GATEWAY_SECRET`: one of the key pairs in the app's
 *   `ACTIVITYMAP_PROVIDER_GATEWAY_KEYS`
 *
 * Without them every run fails as retryable and nothing is written.
 */

/** A typed failure from the gateway that the phase does not handle itself. */
class ProviderFailure extends Error {
  constructor(readonly failure: GatewayFailure) {
    super(`Provider read failed: ${failure.kind}`);
  }
}

function gateway() {
  const origin = process.env.ACTIVITYMAP_APP_ORIGIN;
  const keyId = process.env.ACTIVITYMAP_PROVIDER_GATEWAY_KEY_ID;
  const secret = process.env.ACTIVITYMAP_PROVIDER_GATEWAY_SECRET;
  if (!origin || !keyId || !secret)
    throw new Error('The provider gateway is not configured');
  // Looked up at call time, so a test can stand in for the network.
  return providerGatewayClient({
    origin,
    keyId,
    secret,
    fetcher: (url, init) => fetch(url, init),
  });
}

type Failure =
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'blocked' | 'retry' | 'permanent'; reason: string };

/** How long one sweep run reads pages before it lets another run go on. */
const SWEEP_RUN_MS = 4 * 60_000;

function failureOf(error: unknown): Failure {
  if (error instanceof ProviderFailure) {
    const { failure } = error;
    switch (failure.kind) {
      case 'rate_limited':
        return failure;
      case 'credentials_rejected':
        return { kind: 'blocked', reason: failure.kind };
      // The owner's grant does not cover the activity; asking again changes
      // nothing until the provider reports it again.
      case 'forbidden':
        return { kind: 'permanent', reason: failure.kind };
      // Photos of an activity that was just read: it may be going away.
      case 'not_found':
        return { kind: 'retry', reason: failure.kind };
      case 'upstream_error':
        return {
          kind: failure.retryable ? 'retry' : 'permanent',
          reason: `upstream_error ${failure.status ?? 'network'}`,
        };
    }
  }
  if (error instanceof ForeignProviderActivity)
    return { kind: 'permanent', reason: 'foreign_activity' };
  if (error instanceof InvalidProviderPayload)
    return { kind: 'retry', reason: 'invalid_response' };
  return {
    kind: 'retry',
    reason: error instanceof Error ? error.message : 'error',
  };
}

async function read(
  step: Pick<IngestionStep, 'scope'>,
  operation: GatewayOperation,
) {
  const { userId, athleteId } = step.scope;
  return gateway().call({ userId, athleteId }, operation);
}

/** The activity and its photos, or its deletion. */
async function source(ctx: ActionCtx, step: IngestionStep) {
  const { job, claim, id } = step;
  const expected = { id, athleteId: step.scope.athleteId };
  const detail = await read(step, { kind: 'activity', id });
  if (!detail.ok) {
    if (detail.error.kind !== 'not_found')
      throw new ProviderFailure(detail.error);
    // The provider confirms that the activity is gone.
    return ctx.runMutation(internal.ingestion.publishSource, {
      job,
      claim,
      dto: null,
    });
  }
  const dto = activitySource(detail.data, expected, {
    photosCurrent: true,
    observedAt: new Date(),
  });
  // Without photos the empty set is the current one, and needs no read.
  let photos: ReturnType<typeof photoSources> = [];
  if (hasPhotos(detail.data)) {
    const result = await read(step, { kind: 'photos', id });
    if (!result.ok) throw new ProviderFailure(result.error);
    photos = photoSources(result.data, expected);
  }
  return ctx.runMutation(internal.ingestion.publishSource, {
    job,
    claim,
    dto,
    photos,
  });
}

/** The activity's samples, stored as its recording. */
async function recording(
  ctx: ActionCtx,
  step: IngestionStep & { phase: 'recording' },
) {
  const { job, claim, id } = step;
  // An activity without samples gets an empty recording: that is what
  // records that there is nothing to fetch for it.
  let streams: ReturnType<typeof validateRecording> = {};
  if (!step.manual) {
    const result = await read(step, { kind: 'streams', id });
    if (result.ok) {
      try {
        streams = validateRecording(result.data);
      } catch {
        throw new InvalidProviderPayload('streams');
      }
    } else if (result.error.kind !== 'not_found')
      throw new ProviderFailure(result.error);
  }
  const { file, manifest } = encodeWhole(streams);
  await prepareRecording(ctx, {
    scope: step.scope,
    id,
    generation: step.generation,
    sourceRevision: step.sourceRevision,
    writer: 'convex',
    recordingGeneration: step.recording.generation ?? randomUUID(),
    recordingRevision: step.recording.revision,
    file: await ctx.storage.store(new Blob([new Uint8Array(file)])),
    manifest,
  });
  // On to the match of the new recording.
  return ctx.runMutation(internal.ingestion.advance, { job, claim });
}

/** The places along the activity's recording. */
async function match(ctx: ActionCtx, step: IngestionStep & { phase: 'match' }) {
  const { job, claim, id } = step;
  const catalogue = step.catalogues.find((rowset) =>
    isMatchingVersion(rowset, step.matchingVersion),
  );
  // Without the rowset the owner's matching version names there is nothing
  // to match against, and the activity is finished without a match.
  if (!catalogue) {
    await ctx.runMutation(internal.ingestion.complete, { job, claim });
    return null;
  }
  const prepared = await prepareActivity(ctx, {
    key: id,
    id,
    recording: step.recording,
  });
  const [matched] = await matchPrepared(
    ctx,
    {
      userId: step.scope.userId,
      catalogue,
      published: await readCatalogue(ctx, catalogue),
    },
    [prepared],
  );
  await ctx.runMutation(internal.ingestion.matched, {
    job,
    claim,
    recording: step.recording.id,
    // As Postgres serves it: the result names its matching version.
    result: { ...matched!.result, matchingVersion: step.matchingVersion },
  });
  return null;
}

export const run = internalAction({
  args: { job: v.id('ingestionJobs') },
  handler: async (ctx, { job }): Promise<void> => {
    let step: IngestionStep | null = await ctx.runMutation(
      internal.ingestion.claim,
      { job },
    );
    while (step) {
      const { claim } = step;
      try {
        step =
          step.phase === 'source'
            ? await source(ctx, step)
            : step.phase === 'recording'
              ? await recording(ctx, step)
              : await match(ctx, step);
      } catch (error) {
        await ctx.runMutation(internal.ingestion.fail, {
          job,
          claim,
          failure: failureOf(error),
        });
        return;
      }
    }
  },
});

/** One page of the owner's activity list, as reconciliation records it. */
async function listPage(step: SweepStep) {
  const result = await read(
    { scope: { userId: step.userId, athleteId: step.athleteId, epoch: '' } },
    {
      kind: 'activities',
      page: step.page,
      perPage: SWEEP_PAGE_SIZE,
      before: step.before,
    },
  );
  if (!result.ok) throw new ProviderFailure(result.error);
  if (!Array.isArray(result.data) || result.data.length > SWEEP_PAGE_SIZE)
    throw new InvalidProviderPayload('activity list');
  return result.data.map((entry) => {
    const summary = activitySummary(entry, step.athleteId);
    return {
      ...summary,
      fingerprint: createHash('sha256')
        .update(JSON.stringify(summary.fields))
        .digest('hex'),
    };
  });
}

/** One run of an owner's reconciliation sweep (convex/ingestionSweep.ts). */
export const sweep = internalAction({
  args: { owner: v.id('owners') },
  handler: async (ctx, args): Promise<void> => {
    const owner: Id<'owners'> = args.owner;
    const started = Date.now();
    let step: SweepStep | null = await ctx.runMutation(
      internal.ingestionSweep.claim,
      { owner },
    );
    while (step) {
      const { claim } = step;
      try {
        if (step.phase === 'confirming') {
          await ctx.runMutation(internal.ingestionSweep.confirm, {
            owner,
            claim,
          });
          return;
        }
        if (Date.now() - started > SWEEP_RUN_MS) {
          await ctx.runMutation(internal.ingestionSweep.fail, {
            owner,
            claim,
            failure: { kind: 'yield' },
          });
          return;
        }
        const items = await listPage(step);
        // Entries never seen here become summary activities first, so the
        // page below finds them stored and unchanged.
        const fresh = new Set(
          await ctx.runQuery(internal.ingestionSweep.unknown, {
            owner,
            ids: items.map((item) => item.id),
          }),
        );
        const summaries = items.flatMap(({ id, dto }) =>
          fresh.has(id) && dto ? [{ id, dto }] : [],
        );
        for (let i = 0; i < summaries.length; i += SUMMARIES_PER_CALL)
          await ctx.runMutation(internal.ingestionSweep.addSummaries, {
            owner,
            claim,
            items: summaries.slice(i, i + SUMMARIES_PER_CALL),
          });
        step = await ctx.runMutation(internal.ingestionSweep.applyPage, {
          owner,
          claim,
          page: step.page,
          items: items.map(({ id, fingerprint, fields }) => ({
            id,
            fingerprint,
            fields,
          })),
        });
      } catch (error) {
        const failure = failureOf(error);
        await ctx.runMutation(internal.ingestionSweep.fail, {
          owner,
          claim,
          // A list is never given up: the next attempt may work.
          failure:
            failure.kind === 'rate_limited'
              ? failure
              : {
                  kind: failure.kind === 'blocked' ? 'blocked' : 'retry',
                  reason: failure.reason,
                },
        });
        return;
      }
    }
  },
});
