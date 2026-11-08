import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import postgres from 'postgres';
import ws, { WebSocketServer, createWebSocketStream } from 'ws';

import type { ActivityPlacesResponse } from '../src/contracts/activity-places';
import { processPlaceMatching } from '../src/server/application/place-matching';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../src/server/db/migration-tooling';
import * as schema from '../src/server/db/schema';
import { MATCHING_RECIPE_HASH } from '../src/server/places/matching-version';
import { loadBatchPlaceCatalogue } from '../src/server/repositories/batch-place-catalogue';
import { createPlaceMatchingRepository } from '../src/server/repositories/place-matching';

const { values } = parseArgs({
  options: {
    limit: { type: 'string', default: '500' },
    mode: { type: 'string', default: 'after' },
    idle: { type: 'boolean', default: false },
    out: {
      type: 'string',
      default: 'output/quality/batch-places/io-after.json',
    },
  },
});
const limit = Number(values.limit);
if (
  !Number.isInteger(limit) ||
  limit < 1 ||
  limit > 2_000 ||
  !['before', 'after'].includes(values.mode)
)
  throw new Error('Invalid benchmark options');
const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
)
  throw new Error(
    'Write-path benchmarks require an isolated guarded local *_test database',
  );
const admin = postgres(target.connectionString, {
  max: 1,
  prepare: false,
  onnotice: () => undefined,
});
await verifyConnectedTarget(admin, target);
const proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 });
proxy.on('connection', (socket) => {
  const upstream = connect({
    host: target.hostname,
    port: Number(new URL(target.connectionString).port || 5432),
  });
  const downstream = createWebSocketStream(socket);
  upstream.on('error', () => downstream.destroy());
  downstream.on('error', () => upstream.destroy());
  downstream.on('close', () => upstream.destroy());
  upstream.on('close', () => downstream.destroy());
  downstream.pipe(upstream).pipe(downstream);
});
await once(proxy, 'listening');
const address = proxy.address();
assert(address && typeof address !== 'string');
neonConfig.webSocketConstructor = ws;
neonConfig.useSecureWebSocket = false;
neonConfig.forceDisablePgSSL = true;
neonConfig.pipelineConnect = false;
neonConfig.wsProxy = () => `127.0.0.1:${address.port}/v2`;
const pool = new Pool({ connectionString: target.connectionString, max: 2 });
let statements = 0;
const database = drizzle({
  client: pool,
  schema,
  logger: {
    logQuery() {
      statements++;
    },
  },
});
let worker = processPlaceMatching,
  factory = createPlaceMatchingRepository;
if (values.mode === 'before') {
  // Historical copies are deliberately outside the production source tree.
  // See docs/on-demand-places.md for creating them from a reviewed Git ref.
  const previousWorker = (await import(
    pathToFileURL(resolve('output/quality/batch-io-before/worker.ts')).href
  )) as { processPlaceMatching: typeof worker };
  const previousRepository = (await import(
    pathToFileURL(resolve('output/quality/batch-io-before/repository.ts')).href
  )) as { createPlaceMatchingRepository: typeof factory };
  worker = previousWorker.processPlaceMatching;
  factory = previousRepository.createPlaceMatchingRepository;
}
try {
  if (values.idle) {
    const beforeFeed = (
      await admin<
        { count: number }[]
      >`SELECT count(*)::integer AS count FROM sync_change`
    )[0]!.count;
    const activities = (
      await admin<
        { count: number }[]
      >`SELECT count(*)::integer AS count FROM activities`
    )[0]!.count;
    assert(
      activities >= 1000,
      'Idle benchmarks require a settled snapshot with at least 1,000 activities',
    );
    const runs = [];
    for (let i = 0; i < 3; i++) {
      statements = 0;
      const started = performance.now();
      const result = await worker({
        repository: factory(database),
        loadSnapshot: (selection) =>
          loadBatchPlaceCatalogue(database, selection),
      });
      assert.equal(
        result.selected,
        0,
        'Settle all eligible matching work before the idle benchmark',
      );
      assert.equal(result.failed, 0);
      assert.equal(result.stopReason, 'complete');
      runs.push({ wallMs: performance.now() - started, statements, ...result });
    }
    assert.equal(
      (await admin`SELECT count(*)::integer AS count FROM sync_change`)[0]!
        .count,
      beforeFeed,
      'Idle runs must not publish sync events',
    );
    const report = {
      mode: values.mode,
      activities,
      runs,
      scope:
        'Idle worker on a guarded local snapshot with real leases/checkpoint reads; no matching or sync events. First run includes queue initialization when needed.',
    };
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } else {
    const expected = await admin<
      { activity_id: string; result: ActivityPlacesResponse }[]
    >`
    SELECT a.id::text AS activity_id,c.result FROM activity_place_checks c
    JOIN activities a ON a.id=c.activity_id JOIN activity_streams s ON s.activity_id=a.id
    WHERE c.recipe_hash=${MATCHING_RECIPE_HASH} AND c.result IS NOT NULL
      AND c.stream_generation=s.generation AND c.stream_revision=s.revision AND c.source_version=s.source_version
    ORDER BY a.id LIMIT ${limit}
  `;
    assert.equal(
      expected.length,
      limit,
      'Restore a settled reference snapshot into this isolated test database first',
    );
    const ids = expected.map((row) => row.activity_id);
    const beforeFeed = (
      await admin`SELECT count(*)::integer AS count FROM sync_change`
    )[0]!.count as number;
    await admin`DELETE FROM activity_place_checks WHERE recipe_hash=${MATCHING_RECIPE_HASH} AND activity_id=ANY(${ids}::bigint[])`;
    statements = 0;
    const started = performance.now(),
      cpu = process.cpuUsage();
    const runs = [];
    let saved = 0;
    while (saved < limit) {
      const result = await worker({
        repository: factory(database),
        activityIds: ids,
        activityLimit: Math.min(500, limit - saved),
        loadSnapshot: (selection) =>
          loadBatchPlaceCatalogue(database, selection),
      });
      assert.equal(result.failed, 0);
      assert.equal(result.superseded, 0);
      assert(result.saved > 0, 'Write benchmark made no durable progress');
      saved += result.saved;
      runs.push(result);
    }
    const wallSeconds = (performance.now() - started) / 1000,
      used = process.cpuUsage(cpu);
    const persisted = await admin<
      { activity_id: string; result: ActivityPlacesResponse }[]
    >`SELECT activity_id::text AS activity_id,result FROM activity_place_checks WHERE recipe_hash=${MATCHING_RECIPE_HASH} AND activity_id=ANY(${ids}::bigint[]) ORDER BY activity_id`;
    assert.deepEqual(
      persisted.map((row) => ({ ...row })),
      expected.map((row) => ({ ...row })),
      'Durable results differ from the reference',
    );
    const afterFeed = (
      await admin`SELECT count(*)::integer AS count FROM sync_change`
    )[0]!.count as number;
    assert.equal(
      afterFeed - beforeFeed,
      limit,
      'Exactly one sync event per committed result',
    );
    const report = {
      mode: values.mode,
      measuredAt: new Date().toISOString(),
      activities: saved,
      statements,
      statementsPerActivity: statements / saved,
      wallSeconds,
      applicationCpuSeconds: (used.user + used.system) / 1e6,
      peakProcessRssMiB: process.resourceUsage().maxRSS / 1024,
      runs,
      scope:
        'Guarded local snapshot; real input reads, leases, freshness/authorization locks, result upserts, sync-feed inserts and commits. Each persisted result and sync-event count verified. No production writes or Strava calls. Local RTT/hardware differ from production.',
    };
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  await pool.end();
  await admin.end();
  proxy.close();
}
