// Run from a checkout with dependencies installed:
// node --env-file=.env scripts/verify-ios-sync-local.mjs <simulator-udid> [derived-data-path]
// Requires the normal dev server on localhost:3000. Only a temporary local
// session is created; no activity data or Strava credentials are modified.
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

const url = new URL(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '');
assert(['localhost', '127.0.0.1', 'db.localtest.me'].includes(url.hostname), 'Only the local Docker database is permitted');
assert.equal(url.port || '5432', '5432');
assert.equal(url.pathname, '/main');
url.hostname = '127.0.0.1';
assert(process.env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET is required to sign the temporary local session');
const simulator = process.argv[2];
assert(simulator && /^[0-9a-f-]{36}$/i.test(simulator), 'Pass a simulator UDID');
const sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => undefined });
const id = `ios-sync-proof-${randomUUID()}`;
const rawToken = randomBytes(32).toString('hex');
try {
  const [user] = await sql`
    select u.id, u.athlete_id,
      (select count(*)::int from activities a where a.athlete = u.athlete_id) as activities,
      (select count(*)::int from photos p where p.athlete_id = u.athlete_id) as photos
    from "user" u
    where exists (select 1 from account a where a."userId" = u.id and a."providerId" = 'strava'
      and a.revoked_at is null and coalesce(a."accessToken", a.access_token) is not null)
    order by activities desc limit 1`;
  assert(user && user.activities > 0, 'A local connected account with activities is needed');
  await sql`insert into session (id, token, "userId", "expiresAt")
    values (${id}, ${rawToken}, ${user.id}, ${new Date(Date.now() + 30 * 60_000)})`;
  // Better Auth forwards this to its signed-cookie reader, which expects a
  // padded base64 signature (44 characters), not an unpadded JWT signature.
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(rawToken).digest('base64');
  const token = encodeURIComponent(`${rawToken}.${signature}`);
  const me = await fetch('http://localhost:3000/api/v1/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200, 'Local server must accept the temporary session');
  assert.equal((await me.json()).data.id, user.id);
  const args = [
    'test', '-project', 'ios/ActivityMap/ActivityMap.xcodeproj', '-scheme', 'ActivityMap',
    '-configuration', 'Debug', '-destination', `platform=iOS Simulator,id=${simulator}`,
    '-parallel-testing-enabled', 'NO', '-only-testing:ActivityMapTests/LiveSyncTests',
    'CODE_SIGNING_ALLOWED=NO',
  ];
  if (process.argv[3]) args.push('-derivedDataPath', process.argv[3]);
  const result = spawnSync('xcodebuild', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000,
    env: {
      ...process.env,
      TEST_RUNNER_ACTIVITYMAP_SYNC_TEST_TOKEN: token,
      TEST_RUNNER_ACTIVITYMAP_SYNC_EXPECTED_ACTIVITIES: String(user.activities),
      TEST_RUNNER_ACTIVITYMAP_SYNC_EXPECTED_PHOTOS: String(user.photos),
    },
  });
  // Keep build noise and credentials out of the proof output.
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const evidence = output.match(/LOCAL_SYNC_PROOF_PASSED activities=\d+ photos=\d+/)?.[0];
  assert.equal(result.status, 0, 'Xcode live-sync test failed; inspect the local Xcode result bundle');
  assert(evidence, 'Live test did not execute (check TEST_RUNNER environment forwarding)');
  console.log(evidence);
} finally {
  await sql`delete from session where id = ${id} and token = ${rawToken}`;
  await sql.end({ timeout: 5 });
}
