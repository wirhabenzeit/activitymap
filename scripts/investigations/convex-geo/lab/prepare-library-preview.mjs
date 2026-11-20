// Export only the approved retained library's metadata from local Postgres.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import postgres from 'postgres';

import { toActivityDTO } from '../../../../src/contracts/v1/activity';

const base = new URL('./results/', import.meta.url);
const plan = JSON.parse(
  await readFile(new URL('full-library-validation-1/plan.json', base)),
);
const session = JSON.parse(
  await readFile(new URL('full-library-validation-1/session.json', base)),
);
const owners = new Set(plan.records.map((row) => row.owner));
assert.equal(
  owners.size,
  1,
  'Select an explicit source owner for multi-owner libraries',
);
const [sourceUserId] = owners;
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5432/main', {
  max: 1,
});
try {
  const result = await sql.begin(
    'isolation level repeatable read read only',
    async (tx) => {
      const [user] =
        await tx`select id, name, athlete_id from "user" where id = ${sourceUserId}`;
      assert(user);
      const records = [];
      for (let offset = 0; offset < plan.records.length; offset += 64) {
        const chunk = plan.records.slice(offset, offset + 64);
        const rows =
          await tx`select a.*, md5(activity_stream_source(a)::text) as source_version
        from activities a where a.athlete = ${user.athlete_id} and a.id in ${tx(chunk.map((row) => row.key))}`;
        const byId = new Map(rows.map((row) => [String(row.id), row]));
        for (const frozen of chunk) {
          const row = byId.get(frozen.key);
          assert(row, 'Retained activity metadata missing locally');
          assert.equal(
            row.source_version,
            frozen.sourceVersion,
            'Local activity no longer matches retained GPS',
          );
          const activity = toActivityDTO({
            ...row,
            geometryState: row.geometry_state,
            photosState: row.photos_state,
            lastSummarySeenAt: row.last_summary_seen_at,
            lastDetailedFetchedAt: row.last_detailed_fetched_at,
          });
          records.push({ index: frozen.index, activity });
        }
      }
      return {
        run: session.run,
        manifestHash: session.manifestHash,
        sourceUserId,
        athleteId: Number(user.athlete_id),
        name: user.name,
        records,
      };
    },
  );
  const directory = new URL('real-library-preview/', base);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(new URL('metadata.json', directory), JSON.stringify(result), {
    mode: 0o600,
  });
  const sizes = result.records.map((row) =>
    Buffer.byteLength(JSON.stringify(row.activity)),
  );
  console.log(
    JSON.stringify({
      activities: sizes.length,
      metadataBytes: sizes.reduce((a, b) => a + b, 0),
      largestActivityBytes: Math.max(...sizes),
      over64KiB: sizes.filter((size) => size > 64 * 1024).length,
    }),
  );
} finally {
  await sql.end();
}
