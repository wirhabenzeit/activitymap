import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ quiet: true });
const athleteId = process.argv[2];
if (!athleteId || !/^\d+$/.test(athleteId))
  throw new Error('Supply the athlete ID as the first argument.');
const url = process.env.PROTOTYPE_DATABASE_URL;
if (!url)
  throw new Error(
    'Explicit PROTOTYPE_DATABASE_URL required; never silently choose another database.',
  );
const directory = path.resolve(
  process.argv[3] ?? 'output/activity-name-prototype',
);
await mkdir(path.join(directory, 'routes'), { recursive: true });
const db = postgres(url, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  connection: { default_transaction_read_only: true, statement_timeout: 30000 },
});
try {
  const query = await readFile(
    new URL('./sample.sql', import.meta.url),
    'utf8',
  );
  const activities = await db.unsafe<
    { id: string; name: string; category: string }[]
  >(query, [athleteId]);
  for (const activity of activities) {
    const rows =
      await db`select jsonb_build_object('latlng', s.payload->'latlng', 'altitude', s.payload->'altitude', 'distance', s.payload->'distance') as streams from activity_streams s join activities a on a.id=s.activity_id where a.athlete=${athleteId}::bigint and a.id=${activity.id}::bigint`;
    if (!rows[0]?.streams)
      throw new Error(`No stored streams for sample ${activity.id}`);
    await writeFile(
      path.join(directory, 'routes', `${activity.id}.json`),
      JSON.stringify(rows[0].streams),
    );
  }
  await writeFile(
    path.join(directory, 'sample.json'),
    JSON.stringify(
      {
        selection: {
          since: '2023-01-01',
          minimumKm: { ski: 5, hike: 5, bike: 50 },
          strategy:
            'Latest 2, highest ascent 2, fixed hash sample 2 per category; overlaps deduplicated; titles withheld from matching.',
        },
        activities,
      },
      null,
      2,
    ),
  );
  console.log(
    `Exported ${activities.length} activities read-only to ${directory}`,
  );
} catch (error) {
  // Connection failures can contain connection details. Do not echo secrets.
  console.error(
    'Read-only sample export failed:',
    (error as { code?: string }).code ??
      'check configuration or stored streams',
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
