import assert from 'node:assert/strict';

import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { postgresWriterStore } from '../../src/server/convex-mirror/handoff-postgres';
import { resolveMigrationTarget } from '../../src/server/db/migration-tooling';
import {
  activities,
  photos,
  stravaWebhookEvents,
  users,
} from '../../src/server/db/schema';
import {
  bypassWriterFence,
  isWriterFencedError,
  setWriter,
} from '../../src/server/db/writer-fence';
import {
  CONVEX_DISPATCH_RETRY_MS,
  createWebhookDispatchRepository,
  createWebhookEventsRepository,
} from '../../src/server/repositories/webhook-events';

/**
 * Proves the writer fence of migration 0031 against a real database: which
 * writes it refuses, that other owners are unaffected, the bypass, and the
 * ordering guarantees around a handoff.
 */
const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'Writer fence proofs may only modify a guarded local *_test database',
  );
}
const client = postgres(target.connectionString, {
  max: 4,
  prepare: false,
  onnotice: () => undefined,
});
const db = drizzle(client);

const owner = { id: 'fence-proof-owner', athlete: 9183001 };
const other = { id: 'fence-proof-other', athlete: 9183002 };
const activityOf = (athlete: number) => athlete * 10;

async function cleanup() {
  await db.transaction(async (tx) => {
    await tx.execute(bypassWriterFence);
    for (const { id, athlete } of [owner, other]) {
      await tx.delete(activities).where(eq(activities.athlete, athlete));
      await tx.delete(users).where(eq(users.id, id));
    }
  });
}
const activityRow = (athlete: number, id = activityOf(athlete)) => ({
  id,
  public_id: id,
  athlete,
  name: 'Fence fixture',
  sport_type: 'Ride' as const,
  start_date: new Date('2026-01-01T08:00:00Z'),
  start_date_local: new Date('2026-01-01T08:00:00Z'),
  timezone: 'UTC',
  geometryState: 'summary' as const,
});
const photoRow = (athlete: number, id: string) => ({
  unique_id: id,
  activity_id: activityOf(athlete),
  athlete_id: athlete,
  type: 1,
});
async function seed() {
  for (const { id, athlete } of [owner, other]) {
    await db.insert(users).values({ id, athlete_id: athlete });
    await db.insert(activities).values(activityRow(athlete));
    await db
      .insert(photos)
      .values(
        photoRow(athlete, `fence-${athlete}`) as typeof photos.$inferInsert,
      );
  }
}
const epochOf = async (id: string) =>
  (
    await db
      .select({ epoch: users.writerEpoch })
      .from(users)
      .where(eq(users.id, id))
  )[0]!.epoch;
async function hand(id: string, writer: 'postgres' | 'handoff' | 'convex') {
  const rows = await db.execute(setWriter(id, writer, await epochOf(id)));
  assert.equal(rows.length, 1, 'the handoff applied');
}
async function fenced(write: () => Promise<unknown>, what: string) {
  await assert.rejects(
    write,
    (error) => {
      assert(isWriterFencedError(error), `${what}: refused by the fence`);
      return true;
    },
    what,
  );
}
/** Every kind of write to one owner's rows, as [description, write]. */
function writes(athlete: number, executor: typeof db = db) {
  const id = activityOf(athlete);
  return [
    [
      'update an activity',
      () =>
        executor
          .update(activities)
          .set({ name: 'Renamed' })
          .where(eq(activities.id, id)),
    ],
    [
      'insert an activity',
      () => executor.insert(activities).values(activityRow(athlete, id + 1)),
    ],
    [
      'update a photo',
      () =>
        executor
          .update(photos)
          .set({ caption: 'Changed' })
          .where(eq(photos.unique_id, `fence-${athlete}`)),
    ],
    [
      'insert a photo',
      () =>
        executor
          .insert(photos)
          .values(
            photoRow(
              athlete,
              `fence-new-${athlete}`,
            ) as typeof photos.$inferInsert,
          ),
    ],
    [
      'delete a photo',
      () => executor.delete(photos).where(eq(photos.athlete_id, athlete)),
    ],
    // The fence runs before the column checks, so a bare row is enough to
    // show which of the two refuses.
    [
      'insert activity streams',
      () =>
        executor.execute(
          sql`INSERT INTO activity_streams (activity_id) VALUES (${id})`,
        ),
    ],
    [
      'insert a place result',
      () =>
        executor.execute(
          sql`INSERT INTO activity_places (activity_id) VALUES (${id})`,
        ),
    ],
    [
      'insert a place check',
      () =>
        executor.execute(
          sql`INSERT INTO activity_place_checks (activity_id) VALUES (${id})`,
        ),
    ],
    [
      'delete an activity',
      () => executor.delete(activities).where(eq(activities.id, id)),
    ],
  ] as const;
}

try {
  await cleanup();
  await seed();

  // 1. While Postgres writes, the fence is invisible: the complete rows go
  // in, and the bare ones fail on their columns, not on the fence.
  for (const [what, write] of writes(other.athlete)) {
    try {
      await write();
    } catch (error) {
      assert(!isWriterFencedError(error), `${what}: not fenced for postgres`);
      assert(what.startsWith('insert a place') || what.includes('streams'));
    }
  }
  await cleanup();
  await seed();

  // 2. In handoff and under Convex, every write to the owner is refused, and
  // nothing of it lands. The other owner is untouched by this.
  for (const writer of ['handoff', 'convex'] as const) {
    await hand(owner.id, writer);
    for (const [what, write] of writes(owner.athlete))
      await fenced(write, `${writer}: ${what}`);
    const [kept] = await db
      .select({ name: activities.name })
      .from(activities)
      .where(eq(activities.athlete, owner.athlete));
    assert.equal(kept?.name, 'Fence fixture');
    await db
      .update(activities)
      .set({ name: `Other owner under ${writer}` })
      .where(eq(activities.athlete, other.athlete));
  }
  // An activity cannot be moved to or away from a fenced owner.
  await fenced(
    () =>
      db
        .update(activities)
        .set({ athlete: owner.athlete })
        .where(eq(activities.athlete, other.athlete)),
    'move an activity to a fenced owner',
  );

  // 3. The bypass covers its own transaction only, and lets a delete
  // cascade to the rows that hang off an activity.
  await db.transaction(async (tx) => {
    await tx.execute(bypassWriterFence);
    await tx
      .update(activities)
      .set({ name: 'Replica write' })
      .where(eq(activities.athlete, owner.athlete));
  });
  await fenced(
    () =>
      db
        .update(activities)
        .set({ name: 'After the bypass' })
        .where(eq(activities.athlete, owner.athlete)),
    'the bypass ended with its transaction',
  );
  await db.transaction(async (tx) => {
    await tx.execute(bypassWriterFence);
    await tx.delete(activities).where(eq(activities.athlete, owner.athlete));
  });
  assert.equal(
    (
      await db
        .select({ id: photos.unique_id })
        .from(photos)
        .where(eq(photos.athlete_id, owner.athlete))
    ).length,
    0,
    'photos went with their activity',
  );

  // 4. A handoff is a compare-and-set on the epoch.
  const stale = await epochOf(owner.id);
  await hand(owner.id, 'postgres');
  assert.equal(
    (await db.execute(setWriter(owner.id, 'convex', stale))).length,
    0,
    'a handoff from an old epoch does nothing',
  );
  await db.insert(activities).values(activityRow(owner.athlete));

  // 5. A handoff waits for a transaction that has already written for the
  // owner, so that write is finished before the writer changes.
  const epoch = await epochOf(owner.id);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let wrote!: () => void;
  const written = new Promise<void>((resolve) => (wrote = resolve));
  const inFlight = db.transaction(async (tx) => {
    await tx
      .update(activities)
      .set({ name: 'In flight' })
      .where(eq(activities.athlete, owner.athlete));
    wrote();
    await hold;
  });
  await written;
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '300ms'`);
      await tx.execute(setWriter(owner.id, 'handoff', epoch));
    }),
    'the handoff waits behind the in-flight write',
  );
  release();
  await inFlight;
  assert.equal(
    (await db.execute(setWriter(owner.id, 'handoff', epoch))).length,
    1,
  );
  assert.equal(
    (
      await db
        .select({ name: activities.name })
        .from(activities)
        .where(eq(activities.athlete, owner.athlete))
    )[0]?.name,
    'In flight',
  );

  // 6. Work that started before a handoff cannot write after it, even with
  // a snapshot in which Postgres was still the writer.
  await hand(owner.id, 'postgres');
  let proceed!: () => void;
  const handedOff = new Promise<void>((resolve) => (proceed = resolve));
  let began!: () => void;
  const started = new Promise<void>((resolve) => (began = resolve));
  const late = db.transaction(
    async (tx) => {
      // Takes the snapshot: Postgres is the writer here.
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, owner.id));
      began();
      await handedOff;
      await tx
        .update(activities)
        .set({ name: 'Written late' })
        .where(eq(activities.athlete, owner.athlete));
    },
    { isolationLevel: 'repeatable read' },
  );
  await started;
  await hand(owner.id, 'handoff');
  proceed();
  await assert.rejects(late, 'a write selected before the handoff is refused');
  assert.equal(
    (
      await db
        .select({ name: activities.name })
        .from(activities)
        .where(eq(activities.athlete, owner.athlete))
    )[0]?.name,
    'In flight',
  );

  // 6b. Webhook events of an owner in handoff stay recorded: the drain does
  // not select the activity event and nobody can claim it. An athlete event
  // (deauthorization) is processed here whoever writes.
  const events = createWebhookEventsRepository(
    db as unknown as Parameters<typeof createWebhookEventsRepository>[0],
  );
  const eventTime = new Date('2026-01-02T00:00:00Z');
  const event = (
    id: string,
    objectType: 'activity' | 'athlete',
    ownerId: number,
  ) => ({
    id,
    subscriptionId: 918300,
    objectType,
    objectId: objectType === 'activity' ? activityOf(ownerId) : ownerId,
    aspectType: objectType === 'activity' ? 'create' : 'update',
    ownerId,
    eventTime,
    payload: {} as never,
    nextAttemptAt: eventTime,
  });
  const eventIds = ['fence-activity', 'fence-athlete', 'fence-other'];
  await db
    .delete(stravaWebhookEvents)
    .where(inArray(stravaWebhookEvents.id, eventIds));
  await db
    .insert(stravaWebhookEvents)
    .values([
      event('fence-activity', 'activity', owner.athlete),
      event('fence-athlete', 'athlete', owner.athlete),
      event('fence-other', 'activity', other.athlete),
    ]);
  const drainable = async () =>
    (await events.selectDrainCandidates(500, new Date()))
      .map((candidate) => candidate.id)
      .filter((id) => eventIds.includes(id))
      .sort();
  assert.deepEqual(await drainable(), ['fence-athlete', 'fence-other']);
  assert.equal(await events.claim('fence-activity', new Date()), null);
  assert.equal(
    (await events.claim('fence-athlete', new Date()))?.id,
    'fence-athlete',
  );
  // Handed back, the recorded event is there to be processed.
  await hand(owner.id, 'postgres');
  assert.deepEqual(await drainable(), ['fence-activity', 'fence-other']);
  assert.equal(
    (await events.claim('fence-activity', new Date()))?.id,
    'fence-activity',
  );
  // 6c. Under `convex` the drain still leaves the activity event alone and
  // the dispatcher takes it, for that owner only. A deferred event keeps
  // its attempt count and waits; a completed one is done.
  await db
    .update(stravaWebhookEvents)
    .set({ status: 'pending', nextAttemptAt: eventTime })
    .where(inArray(stravaWebhookEvents.id, eventIds));
  const dispatch = createWebhookDispatchRepository(
    db as unknown as Parameters<typeof createWebhookDispatchRepository>[0],
  );
  const dispatchable = async () =>
    (await dispatch.selectCandidates(500, new Date()))
      .map((candidate) => candidate.id)
      .filter((id) => eventIds.includes(id));
  assert.deepEqual(await dispatchable(), []);
  assert.equal(await dispatch.claim('fence-activity', new Date()), null);
  await hand(owner.id, 'handoff');
  assert.deepEqual(await dispatchable(), [], 'not during a handoff');
  await hand(owner.id, 'convex');
  assert.deepEqual(await dispatchable(), ['fence-activity']);
  assert.deepEqual(await drainable(), ['fence-athlete', 'fence-other']);
  assert.equal(await events.claim('fence-activity', new Date()), null);
  assert.equal(await dispatch.claim('fence-other', new Date()), null);
  assert.equal(await dispatch.claim('fence-athlete', new Date()), null);
  const claimedAt = new Date();
  const first = await dispatch.claim('fence-activity', claimedAt);
  assert.equal(first?.userId, owner.id);
  assert.equal(
    await dispatch.claim('fence-activity', new Date()),
    null,
    'one claim at a time',
  );
  assert.ok(first);
  assert.equal(
    await dispatch.defer(first.event, new Error('refused'), claimedAt),
    true,
  );
  const [deferred] = await db
    .select()
    .from(stravaWebhookEvents)
    .where(eq(stravaWebhookEvents.id, 'fence-activity'));
  assert.equal(deferred?.status, 'failed');
  assert.equal(deferred?.attemptCount, 0);
  assert.ok(deferred && deferred.nextAttemptAt > claimedAt);
  assert.deepEqual(await dispatchable(), [], 'waits before it is sent again');
  const later = new Date(claimedAt.getTime() + CONVEX_DISPATCH_RETRY_MS);
  const second = await dispatch.claim('fence-activity', later);
  assert.ok(second);
  assert.equal(await dispatch.complete(second.event, later), true);
  assert.equal(
    await dispatch.complete(second.event, later),
    false,
    'a lease completes once',
  );
  assert.equal(await dispatch.claim('fence-activity', later), null);

  // A dispatcher that dies between claim and delivery: stale-lease recovery
  // returns the event without counting an attempt, even at nine attempts,
  // where one more counted attempt would dead-letter it. A drain lease of
  // the same age is still counted.
  await db
    .update(stravaWebhookEvents)
    .set({ status: 'pending', attemptCount: 9, nextAttemptAt: eventTime })
    .where(inArray(stravaWebhookEvents.id, eventIds));
  const crashedAt = new Date();
  assert.ok(await dispatch.claim('fence-activity', crashedAt));
  assert.ok(await events.claim('fence-other', crashedAt));
  const recoveredAt = new Date(crashedAt.getTime() + 60_000);
  assert.ok(
    (await events.resetStaleProcessing(
      new Date(crashedAt.getTime() + 1),
      recoveredAt,
    )) >= 2,
  );
  const afterCrash = new Map(
    (
      await db
        .select()
        .from(stravaWebhookEvents)
        .where(inArray(stravaWebhookEvents.id, eventIds))
    ).map((row) => [row.id, row]),
  );
  assert.equal(afterCrash.get('fence-activity')?.status, 'failed');
  assert.equal(afterCrash.get('fence-activity')?.attemptCount, 9);
  assert.equal(afterCrash.get('fence-other')?.status, 'dead_letter');
  assert.deepEqual(
    (await dispatch.selectCandidates(500, recoveredAt))
      .map((candidate) => candidate.id)
      .filter((id) => eventIds.includes(id)),
    ['fence-activity'],
  );
  const resent = await dispatch.claim('fence-activity', recoveredAt);
  assert.ok(resent, 'the interrupted event is sent again');
  assert.equal(await dispatch.complete(resent.event, recoveredAt), true);
  await db
    .delete(stravaWebhookEvents)
    .where(inArray(stravaWebhookEvents.id, eventIds));
  await hand(owner.id, 'handoff');

  // 6d. The handoff's Postgres steps: a compare-and-set on the epoch, and
  // reconciliation made due for an account handed back.
  const store = postgresWriterStore(
    db as unknown as Parameters<typeof postgresWriterStore>[0],
    owner.id,
  );
  const before = (await store.state())!;
  assert.equal(before.writer, 'handoff');
  assert.equal(
    await store.setWriter('convex', before.epoch - 1),
    null,
    'a stale epoch changes nothing',
  );
  assert.deepEqual(await store.state(), before);
  assert.equal(await store.setWriter('convex', before.epoch), before.epoch + 1);
  await fenced(
    () =>
      db
        .update(activities)
        .set({ name: 'written after the handoff' })
        .where(eq(activities.athlete, owner.athlete)),
    'an activity update for an account Convex writes',
  );
  assert.equal(
    await store.setWriter('postgres', before.epoch + 1),
    before.epoch + 2,
  );
  await db
    .update(users)
    .set({ lastSummaryReconciledAt: new Date() })
    .where(eq(users.id, owner.id));
  await store.reconcileNow();
  assert.equal(
    (
      await db
        .select({ at: users.lastSummaryReconciledAt })
        .from(users)
        .where(eq(users.id, owner.id))
    )[0]?.at,
    null,
  );
  assert.equal(
    await postgresWriterStore(
      db as unknown as Parameters<typeof postgresWriterStore>[0],
      'no-such-user',
    ).state(),
    null,
  );
  await hand(owner.id, 'handoff');

  // 7. Erasing an account removes a fenced owner's rows too.
  assert.equal(
    (
      await db
        .select({ writer: users.writer })
        .from(users)
        .where(eq(users.id, owner.id))
    )[0]?.writer,
    'handoff',
  );
  await db.transaction(async (tx) => {
    await tx.execute(bypassWriterFence);
    await tx.delete(activities).where(eq(activities.athlete, owner.athlete));
    await tx.delete(users).where(eq(users.id, owner.id));
  });
  assert.equal(
    (
      await db
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.athlete, owner.athlete))
    ).length,
    0,
  );

  console.log('Writer fence proofs passed');
} finally {
  await cleanup();
  await client.end();
}
