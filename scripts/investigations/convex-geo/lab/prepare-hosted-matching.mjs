import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import postgres from 'postgres';

import { encodeWhole, sha256, validateRecording } from './recording/codec.ts';
import { recordingSummary } from './recording/processing.ts';

const results = new URL('./results/', import.meta.url);
const plan = JSON.parse(
  await readFile(new URL('full-library/plan-private.json', results)),
);
assert.equal(plan.candidates.length, 4602);
assert.equal(plan.groups.length, 194);
const directory = new URL('hosted-matching-private/', results);
await mkdir(directory, { mode: 0o700, recursive: true });
const save = (file, value) =>
  writeFile(new URL(file, directory), JSON.stringify(value), { mode: 0o600 });
const db = postgres({
  host: '127.0.0.1',
  port: 5432,
  database: 'main',
  username: 'postgres',
  password: 'postgres',
  max: 1,
});
try {
  const records = await db.begin(
    'isolation level repeatable read read only',
    async (tx) => {
      const [catalogue] =
        await tx`SELECT snapshot_id,revision::text FROM place_catalogues
      CROSS JOIN place_catalogue_revision WHERE active AND region_id='ch-at-it' AND singleton`;
      assert.deepEqual(catalogue, {
        snapshot_id: plan.version.snapshotId,
        revision: plan.version.revision,
      });
      const eligible = await tx`
      SELECT a.id::text AS key,u.id AS owner,s.generation,s.revision::text,s.source_version
      FROM activities a JOIN "user" u ON u.athlete_id=a.athlete
      JOIN activity_streams s ON s.activity_id=a.id
      WHERE s.fetched_at IS NOT NULL AND s.invalidated_at IS NULL
        AND s.last_attempt_status <> 'invalidated' AND s.payload IS NOT NULL
        AND s.source_version = md5(activity_stream_source(a)::text)
        AND EXISTS (SELECT 1 FROM account c WHERE c."userId"=u.id AND c."providerId"='strava'
          AND c."accountId"=u.athlete_id::text AND c.revoked_at IS NULL AND c.scheduled_erasure_at IS NULL
          AND (COALESCE(c."accessToken",c.access_token,'')<>'' OR COALESCE(c."refreshToken",c.refresh_token,'')<>''))
      ORDER BY a.id
    `;
      assert.equal(eligible.length, plan.candidates.length);
      const records = [];
      for (let start = 0; start < eligible.length; start += 24) {
        const chunk = eligible.slice(start, start + 24);
        const rows =
          await tx`SELECT activity_id::text AS key,payload FROM activity_streams
        WHERE activity_id IN ${tx(chunk.map((r) => r.key))}`;
        const byKey = new Map(rows.map((r) => [r.key, r.payload]));
        for (const [offset, r] of chunk.entries()) {
          const index = start + offset;
          const c = plan.candidates[index];
          assert(
            r.key === c.activityId &&
              r.owner === c.userId &&
              r.generation === c.generation &&
              r.revision === c.revision &&
              r.source_version === c.sourceVersion,
            'Frozen recording identity changed',
          );
          const streams = validateRecording(byKey.get(r.key));
          const { file, manifest } = encodeWhole(streams);
          const compressedHash = sha256(file, 'base64');
          await writeFile(new URL(`${index}.gz`, directory), file, {
            mode: 0o600,
          });
          await save(`${index}.summary.json`, recordingSummary(streams));
          records.push({
            index,
            owner: r.owner,
            key: r.key,
            generation: r.generation,
            revision: r.revision,
            sourceVersion: r.source_version,
            locationHint: c.locationHint,
            manifest,
            compressedHash,
          });
        }
      }
      return records;
    },
  );
  const owners = {};
  let bytes = 0;
  let uncompressedBytes = 0;
  for (const r of records) {
    owners[r.owner] = (owners[r.owner] ?? 0) + 1;
    bytes += r.manifest.compressedBytes;
    uncompressedBytes += r.manifest.uncompressedBytes;
  }
  const indexHash = createHash('sha256')
    .update(JSON.stringify(records))
    .digest('hex');
  await save('manifest.json', {
    source:
      'local Docker Postgres, repeatable read, eligible current recordings',
    deployment: 'spotted-fennec-603',
    catalogue: plan.version,
    owners,
    activities: records.length,
    bytes,
    uncompressedBytes,
    indexHash,
    records,
  });
  console.log(
    JSON.stringify({
      activities: records.length,
      ownerScopes: Object.keys(owners).length,
      estimatedCompressedBytes: bytes,
      uncompressedBytes,
    }),
  );
} finally {
  await db.end();
}
