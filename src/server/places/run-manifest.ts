import { z } from 'zod';

import { streamActivityIdSchema } from '../strava/streams';
import { canonicalJson, sha256 } from './catalogue-artifact';
import type { EvaluationContext } from './run-types';

export const MAX_RUN_ACTIVITIES = 100;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const token = z.string().min(1).max(256);
export const inputTokensSchema = z.strictObject({
  generation: token,
  revision: z
    .string()
    .max(19)
    .regex(/^(0|[1-9][0-9]*)$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n),
  sourceVersion: token,
});
export const runIdentitySchema = z.strictObject({
  runId: z.uuid(),
  catalogueSnapshotId: token,
  matcherVersion: token,
  parametersHash: hash,
});
export const runActorSchema = z.strictObject({
  userId: z.string().min(1).max(256),
  athleteId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  authentication: z.enum(['cookie', 'bearer']),
});
const recordSchema = z
  .strictObject({
    activityId: streamActivityIdSchema,
    outcome: z.enum([
      'complete',
      'missing_streams',
      'uncovered',
      'partial',
      'failed',
      'superseded',
    ]),
    input: inputTokensSchema.optional(),
    published: z.boolean(),
    matchCount: z.number().int().nonnegative().max(100_000),
    reasons: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(100),
  })
  .superRefine((record, context) => {
    if (record.outcome === 'complete' && !record.input)
      context.addIssue({
        code: 'custom',
        message: 'Complete outcomes require input tokens',
      });
    if (record.published && record.outcome !== 'complete')
      context.addIssue({
        code: 'custom',
        message: 'Only a complete outcome may be published',
      });
  });
const contextSchema = runIdentitySchema.extend({
  actor: runActorSchema,
  activityIds: z.array(streamActivityIdSchema).min(1).max(MAX_RUN_ACTIVITIES),
  records: z.array(recordSchema).max(MAX_RUN_ACTIVITIES),
});
function validateScope(
  value: z.infer<typeof contextSchema>,
  context: z.RefinementCtx,
) {
  const scope = new Set(value.activityIds);
  if (
    scope.size !== value.activityIds.length ||
    new Set(value.records.map((r) => r.activityId)).size !==
      value.records.length
  )
    context.addIssue({
      code: 'custom',
      message: 'Duplicate activity scope or result',
    });
  if (value.records.some((record) => !scope.has(record.activityId)))
    context.addIssue({
      code: 'custom',
      message: 'Result outside the explicit activity scope',
    });
}

/** Files are loaded only by the operator; application/query code accepts this data. */
export function parseEvaluationContext(input: unknown): EvaluationContext {
  return contextSchema.superRefine(validateScope).parse(input);
}

export const runManifestSchema = contextSchema
  .extend({
    formatVersion: z.literal(1),
    mode: z.enum(['dry_run', 'apply']),
    coverageSha256: hash,
    createdAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }).optional(),
    policy: z.record(z.string(), z.json()),
  })
  .superRefine((value, context) => {
    validateScope(value, context);
    if (sha256(canonicalJson(value.policy)) !== value.parametersHash)
      context.addIssue({
        code: 'custom',
        message: 'Policy does not match its parameters hash',
      });
    if (
      value.mode === 'dry_run' &&
      value.records.some((record) => record.published)
    )
      context.addIssue({
        code: 'custom',
        message: 'A dry run cannot publish results',
      });
    if (value.finishedAt && value.records.length !== value.activityIds.length)
      context.addIssue({
        code: 'custom',
        message: 'A finished run must report every scoped activity',
      });
  });
export type RunManifest = z.infer<typeof runManifestSchema>;

export function evaluationContextFromManifest(
  input: unknown,
): EvaluationContext {
  const manifest = runManifestSchema.parse(input);
  return parseEvaluationContext({
    actor: manifest.actor,
    activityIds: manifest.activityIds,
    records: manifest.records,
    runId: manifest.runId,
    catalogueSnapshotId: manifest.catalogueSnapshotId,
    matcherVersion: manifest.matcherVersion,
    parametersHash: manifest.parametersHash,
  });
}
