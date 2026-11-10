'use node';

import { randomUUID } from 'node:crypto';

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
  hasPhotos,
  photoSources,
} from '../ingestion/provider';
import { encodeWhole, validateRecording } from '../recording/codec';
import { internal } from './_generated/api';
import { type ActionCtx, internalAction } from './_generated/server';
import type { IngestionStep } from './ingestion';
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

async function read(step: IngestionStep, operation: GatewayOperation) {
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
  const result = await read(step, { kind: 'streams', id });
  // An activity without samples is finished without a recording.
  if (!result.ok && result.error.kind !== 'not_found')
    throw new ProviderFailure(result.error);
  if (result.ok) {
    let streams;
    try {
      streams = validateRecording(result.data);
    } catch {
      throw new InvalidProviderPayload('streams');
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
  }
  await ctx.runMutation(internal.ingestion.complete, { job, claim });
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
            : await recording(ctx, step);
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
