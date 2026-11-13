// Exercise the exported Next route modules and Better Auth against local Postgres.
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import postgres from 'postgres';

import { resolveDatabaseConnection } from '../../../../src/server/db/connection';

export async function verifyPostgresBoundary(owner, previewCursor) {
  const local = new URL(
    resolveDatabaseConnection(process.env).connectionString,
  );
  assert(
    ['localhost', '127.0.0.1', 'db.localtest.me'].includes(local.hostname) &&
      local.pathname === '/main' &&
      (local.port || '5432') === '5432',
    'The live route proof is restricted to local Docker Postgres',
  );
  local.hostname = '127.0.0.1';
  const sql = postgres(local.toString(), { max: 1, prepare: false });
  const token = randomBytes(32).toString('hex');
  const session = randomUUID();
  assert(process.env.BETTER_AUTH_SECRET);
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET)
    .update(token)
    .digest('base64');
  const signed = encodeURIComponent(`${token}.${signature}`);
  const bearer = { Authorization: `Bearer ${signed}` };
  const cookie = { Cookie: `better-auth.session_token=${signed}` };
  const activityId = 8_500_000_000_000_000 + randomBytes(4).readUInt32BE();
  let userCreated = false;
  const initialMode = process.env.ACTIVITYMAP_CLIENT_BACKEND;
  try {
    await sql`insert into "user" (id, name, email, athlete_id)
      values (${owner.userId}, 'Client proof fixture', ${owner.userId + '@example.invalid'}, ${owner.athleteId})`;
    userCreated = true;
    await sql`insert into session (id, token, "userId", "expiresAt")
      values (${session}, ${token}, ${owner.userId}, ${new Date(Date.now() + 30 * 60_000)})`;
    await sql`insert into activities
      (id, public_id, athlete, name, sport_type, start_date, start_date_local, timezone, geometry_state)
      values (${activityId}, ${activityId}, ${owner.athleteId}, 'Postgres fixture', 'Run',
        now(), now(), 'UTC', 'summary')`;

    const { GET: bootstrap } =
      await import('../../../../src/app/api/v1/sync/bootstrap/route');
    const { GET: changes } =
      await import('../../../../src/app/api/v1/sync/changes/route');
    const { GET: activities } =
      await import('../../../../src/app/api/v1/activities/route');
    const { GET: photos } =
      await import('../../../../src/app/api/v1/photos/route');
    const { GET: summaries } =
      await import('../../../../src/app/api/v1/stream-summaries/compact/route');
    const { GET: status } =
      await import('../../../../src/app/api/v1/ingestion-status/route');
    const { POST: logout } =
      await import('../../../../src/app/api/v1/auth/logout/route');
    const call = (handler, path, headers = bearer, method = 'GET') =>
      handler(
        new Request(`http://localhost:3000/api/v1/${path}`, {
          headers,
          method,
        }),
      );
    const payload = async (response, status = 200) => {
      assert.equal(response.status, status);
      return response.json();
    };

    const preview = await payload(
      await call(bootstrap, 'sync/bootstrap', cookie),
    );
    assert.deepEqual(
      preview.data.items.map((row) => row.id),
      ['1'],
    );
    assert.deepEqual(
      (await payload(await call(activities, 'activities'))).data.items.map(
        (row) => row.id,
      ),
      ['1'],
    );
    assert.equal(
      (await payload(await call(photos, 'photos'))).data.items.length,
      1,
    );
    assert.deepEqual(
      (
        await payload(await call(summaries, 'stream-summaries/compact?ids=1'))
      ).data.summaries.map((row) => row.activity_id),
      ['1'],
    );
    assert.equal(
      (await payload(await call(status, 'ingestion-status'))).data.history
        .knownActivityCount,
      1,
    );
    process.env.ACTIVITYMAP_CLIENT_BACKEND = 'postgres';
    const switched = await payload(
      await call(changes, `sync/changes?cursor=${previewCursor}`),
      409,
    );
    assert.equal(switched.error.code, 'sync_rebootstrap_required');
    const pg = await payload(await call(bootstrap, 'sync/bootstrap'));
    assert.deepEqual(
      pg.data.items.map((row) => row.id),
      [String(activityId)],
    );
    const { activitiesRepository } =
      await import('../../../../src/server/repositories/activities');
    const [initial] = await activitiesRepository.findManyByIds([activityId]);
    assert(initial);
    await activitiesRepository.upsertOne({
      ...initial,
      name: 'Postgres fixture updated',
    });
    const delta = await payload(
      await call(changes, `sync/changes?cursor=${pg.data.snapshotCursor}`),
    );
    assert.equal(
      delta.data.items.at(-1).activity.name,
      'Postgres fixture updated',
    );
    await activitiesRepository.deleteManyForAthlete(owner.athleteId, [
      activityId,
    ]);
    const tombstone = await payload(
      await call(changes, `sync/changes?cursor=${delta.data.nextCursor}`),
    );
    assert.equal(tombstone.data.items.at(-1).operation, 'delete');

    process.env.ACTIVITYMAP_CLIENT_BACKEND = 'convex-preview';
    const back = await payload(
      await call(changes, `sync/changes?cursor=${pg.data.snapshotCursor}`),
      409,
    );
    assert.equal(back.error.code, 'sync_rebootstrap_required');
    await payload(await call(logout, 'auth/logout', bearer, 'POST'));
    await payload(await call(bootstrap, 'sync/bootstrap'), 401);
    await payload(await call(bootstrap, 'sync/bootstrap', cookie), 401);
    console.log(
      'Exported Next handlers passed real local Better Auth cookie/bearer, Postgres upsert/delete, both backend switches and logout.',
    );
  } finally {
    if (initialMode === undefined)
      delete process.env.ACTIVITYMAP_CLIENT_BACKEND;
    else process.env.ACTIVITYMAP_CLIENT_BACKEND = initialMode;
    if (userCreated) {
      await sql`delete from activity_deletions where athlete_id = ${owner.athleteId} and activity_id = ${activityId}`;
      await sql`delete from "user" where id = ${owner.userId}`;
    }
    await sql.end({ timeout: 5 });
  }
}
