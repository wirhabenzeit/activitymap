import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import test from 'node:test';

import { canonicalJson, sha256 } from './catalogue-artifact';
import {
  evaluationContextFromManifest,
  parseEvaluationContext,
  runManifestSchema,
} from './run-manifest';

function fixture() {
  return {
    formatVersion: 1,
    mode: 'apply',
    runId: randomUUID(),
    catalogueSnapshotId: 'snapshot',
    matcherVersion: 'test',
    parametersHash: sha256(canonicalJson({ radius: 1 })),
    policy: { radius: 1 },
    coverageSha256: 'a'.repeat(64),
    createdAt: '2026-10-22T12:00:00Z',
    actor: { userId: 'u', athleteId: 1, authentication: 'bearer' },
    activityIds: ['9007199254740993'],
    records: [],
  };
}

void test('interrupted manifest retains explicit scope without inventing a result', () => {
  const context = evaluationContextFromManifest(fixture());
  assert.deepEqual(context.activityIds, ['9007199254740993']);
  assert.deepEqual(context.records, []);
  assert.throws(
    () =>
      runManifestSchema.parse({
        ...fixture(),
        finishedAt: '2026-10-22T12:01:00Z',
      }),
    /every scoped/,
  );
});

void test('policy tampering, invalid scope and unsupported completion claims are rejected', () => {
  assert.throws(
    () =>
      evaluationContextFromManifest({ ...fixture(), policy: { radius: 2 } }),
    /hash/,
  );
  const context = evaluationContextFromManifest(fixture());
  const record = {
    activityId: context.activityIds[0],
    outcome: 'complete',
    published: true,
    matchCount: 0,
    reasons: [],
  };
  assert.throws(
    () => parseEvaluationContext({ ...context, records: [record] }),
    /tokens/,
  );
  assert.throws(
    () =>
      parseEvaluationContext({
        ...context,
        activityIds: ['1'],
        records: [
          {
            ...record,
            input: { generation: 'g', revision: '1', sourceVersion: 's' },
          },
        ],
      }),
    /outside/,
  );
  assert.throws(
    () =>
      parseEvaluationContext({
        ...context,
        records: [{ ...record, outcome: 'failed' }],
      }),
    /Only a complete/,
  );
});

void test('complete zero-result publication is explicit and dry-run cannot claim it', () => {
  const manifest = {
    ...fixture(),
    records: [
      {
        activityId: '9007199254740993',
        outcome: 'complete',
        published: true,
        matchCount: 0,
        reasons: [],
        input: { generation: 'g', revision: '1', sourceVersion: 's' },
      },
    ],
  };
  assert.equal(
    evaluationContextFromManifest(manifest).records[0]?.matchCount,
    0,
  );
  assert.throws(
    () => evaluationContextFromManifest({ ...manifest, mode: 'dry_run' }),
    /dry run/,
  );
});
