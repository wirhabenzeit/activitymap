import assert from 'node:assert/strict';

import test from 'node:test';

import type { AdminSnapshot, AdminUser } from '~/server/admin/contract';

import {
  ago,
  budgetWindows,
  every,
  lastSyncAt,
  limitedUntil,
  nextCheck,
  problemHref,
  problems,
  rematchProgress,
  tabStates,
  totals,
  until,
  userByAthlete,
  userState,
  withoutLeftovers,
} from './health';

const now = Date.UTC(2026, 10, 25, 14, 32);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const none = { activities: 0, matches: 0, capped: false };

function user(change: Partial<AdminUser> = {}): AdminUser {
  return {
    athleteId: '42',
    createdAt: now - 100 * DAY,
    active: true,
    hasAccount: true,
    revokedAt: null,
    erasureDueAt: null,
    counts: {
      activities: 10,
      recordings: 10,
      photos: 3,
      toFetch: 0,
      rebuilding: false,
    },
    matches: {
      matched: 10,
      rematched: { revision: 3, count: 4 },
      rebuilding: false,
    },
    lastEventAt: now - HOUR,
    sweep: {
      phase: 'idle',
      dueAt: now + 2 * DAY,
      running: false,
      error: null,
      listReadAt: now - 4 * DAY,
    },
    jobs: {
      queued: none,
      failed: none,
      blocked: none,
      reasons: [],
      oldestDueAt: null,
    },
    ...change,
  };
}

type Publication = NonNullable<
  AdminSnapshot['catalogue']
>['publications'][number];
function publication(change: Partial<Publication> = {}): Publication {
  return {
    revision: 3,
    completedAt: now - DAY,
    source: { dataAsOf: now - 2 * DAY, regions: 45 },
    tiles: 200,
    tilesDone: 200,
    walkedAt: now - DAY,
    ...change,
  };
}

function snapshot(
  users: AdminUser[],
  change: Partial<AdminSnapshot> = {},
): AdminSnapshot {
  return {
    observedAt: now,
    lastEventAt: now - HOUR,
    catalogue: {
      revision: 3,
      places: 461_066,
      pending: null,
      tilesLeft: { count: 0, capped: false },
      publications: [publication()],
    },
    budget: [],
    jobs: [],
    subscription: 'registered',
    leftovers: 0,
    users,
    ...change,
  };
}

const texts = (value: AdminSnapshot) =>
  problems(value).map(({ tone, tab, text }) => `${tone} ${tab} ${text}`);
const sweep = (change: object) => ({ sweep: { ...user().sweep!, ...change } });
const jobs = (change: object) => ({ jobs: { ...user().jobs, ...change } });

void test('a healthy snapshot has no problems', () => {
  const value = snapshot([user()]);
  assert.deepEqual(problems(value), []);
  assert.deepEqual(tabStates(value), {
    users: { tone: 'ok', text: '1 user' },
    activities: { tone: 'ok', text: '10 activities' },
    places: { tone: 'ok', text: 'Revision 3, nothing waiting' },
    system: { tone: 'ok', text: 'Strava push registered' },
  });
  assert.deepEqual(userState(user(), now), { tone: 'ok', text: 'Connected' });
});

void test('a list that was not read for seven days is a problem', () => {
  const at = (listReadAt: number | null, createdAt = now - 100 * DAY) =>
    texts(snapshot([user({ createdAt, ...sweep({ listReadAt }) })]));
  assert.deepEqual(at(now - 7 * DAY), []);
  assert.deepEqual(at(now - 7 * DAY - 1), [
    'bad users Strava list not read for 7 days (limit 7 days)',
  ]);
  // Never read: counted from when the user arrived.
  assert.deepEqual(at(null, now - DAY), []);
  assert.deepEqual(at(null, now - 8 * DAY), [
    'bad users Strava list not read for 8 days (limit 7 days)',
  ]);
});

void test('a sweep that is missing, or due and not running, is a problem', () => {
  const late = { dueAt: now - 2 * HOUR };
  assert.deepEqual(texts(snapshot([user(sweep(late))])), [
    'bad users Full check due 2 h ago',
  ]);
  assert.deepEqual(
    texts(snapshot([user(sweep({ ...late, running: true }))])),
    [],
  );
  assert.deepEqual(
    texts(snapshot([user(sweep({ dueAt: now - 59 * MINUTE }))])),
    [],
  );
  assert.deepEqual(
    texts(snapshot([user({ sweep: null, createdAt: now - DAY })])),
    ['bad users No reconciliation scheduled'],
  );
});

void test('queued work that should have run long ago is a problem', () => {
  const at = (oldestDueAt: number) =>
    texts(snapshot([user(jobs({ oldestDueAt }))]));
  assert.deepEqual(at(now - 30 * MINUTE), []);
  assert.deepEqual(at(now - 40 * MINUTE), [
    'bad activities Queued work due 40 min ago has not run',
  ]);
});

void test('failed and blocked work is named by stage, and capped counts say so', () => {
  const value = snapshot([
    user(
      jobs({
        failed: { activities: 248, matches: 2, capped: true },
        blocked: { activities: 14, matches: 0, capped: false },
      }),
    ),
  ]);
  assert.deepEqual(texts(value), [
    'warn users Must reconnect to Strava',
    'warn activities 248+ activities failed',
    'warn places 2+ place matches failed',
  ]);
  assert.equal(problemHref(problems(value)[0]!), '/admin/users/42');
  assert.deepEqual(totals(value).failed, { count: 262, capped: true });
  assert.deepEqual(userState(value.users[0]!, now), {
    tone: 'warn',
    text: 'Must reconnect',
  });
});

void test('a sweep that Strava refused also asks for a reconnect', () => {
  const value = user(sweep({ error: 'credentials_rejected' }));
  assert.deepEqual(texts(snapshot([value])), [
    'warn users Must reconnect to Strava',
  ]);
});

void test('a disconnected user has no problems until its erasure is late', () => {
  const gone = {
    active: false,
    revokedAt: now - 20 * DAY,
    erasureDueAt: now + 10 * DAY,
    ...sweep({ listReadAt: now - 30 * DAY, dueAt: now - 20 * DAY }),
  };
  assert.deepEqual(texts(snapshot([user(gone)])), []);
  assert.deepEqual(userState(user(gone), now), {
    tone: 'off',
    text: 'Awaiting erasure',
  });
  assert.deepEqual(
    texts(snapshot([user({ ...gone, erasureDueAt: now - 2 * DAY })])),
    ['bad users Erasure overdue by 2 days'],
  );
});

void test('the catalogue and the push subscription have problems of their own', () => {
  const value = snapshot([user(jobs({ failed: { ...none, matches: 1 } }))], {
    subscription: 'missing',
    catalogue: {
      revision: 3,
      places: 1,
      pending: { revision: 4, startedAt: now - 5 * HOUR },
      tilesLeft: { count: 1000, capped: true },
      publications: [],
    },
  });
  // Worst first.
  assert.deepEqual(texts(value), [
    'bad system No Strava push subscription for this deployment',
    'warn places 1 place matches failed',
    'warn places Catalogue revision 4 begun 5 h ago and not completed',
  ]);
  assert.equal(problemHref(problems(value)[0]!), '/admin/system');
  // Not knowing is not a problem.
  for (const subscription of ['unknown', 'not_managed'] as const)
    assert.deepEqual(problems(snapshot([user()], { subscription })), []);
});

const published = (...publications: Publication[]) =>
  snapshot([user()], {
    catalogue: {
      ...snapshot([]).catalogue!,
      tilesLeft: { count: 1, capped: false },
      publications,
    },
  });

void test('re-match progress covers the live revision and earlier ones not finished', () => {
  assert.equal(rematchProgress(published()), null);
  assert.equal(rematchProgress(snapshot([], { catalogue: null })), null);
  const value = published(
    // Being applied: its tiles wait.
    publication({ revision: 4, completedAt: null, tiles: 50, tilesDone: 0 }),
    publication({ tilesDone: 199, walkedAt: now - MINUTE }),
    publication({ revision: 2, tiles: 100, tilesDone: 99, walkedAt: now }),
    publication({ revision: 1 }),
  );
  assert.deepEqual(rematchProgress(value), { total: 300, done: 298 });
  assert.deepEqual(problems(value), []);
  // Never 100% before the end.
  assert.deepEqual(tabStates(value).places, {
    tone: 'run',
    text: 'Revision 3, 99% of changed areas checked',
  });
});

void test('a re-match walk without a step for 30 minutes is a problem while it has tiles left', () => {
  const at = (change: Partial<Publication>) =>
    texts(published(publication(change)));
  const left = { tilesDone: 150, walkedAt: now - 30 * MINUTE };
  assert.deepEqual(at(left), []);
  assert.deepEqual(at({ ...left, walkedAt: now - 40 * MINUTE }), [
    'bad places Re-matching for revision 3 stopped 40 min ago with 50 changed areas left',
  ]);
  // It never made a step.
  assert.deepEqual(at({ tilesDone: 199, walkedAt: null }), [
    'bad places Re-matching for revision 3 stopped 24 h ago with 1 changed area left',
  ]);
  assert.deepEqual(at({ ...left, completedAt: null, walkedAt: null }), []);
});

void test('place source data older than 14 days is a problem, when it is known', () => {
  const at = (dataAsOf: number) =>
    texts(published(publication({ source: { dataAsOf, regions: 45 } })));
  assert.deepEqual(at(now - 14 * DAY), []);
  assert.deepEqual(at(now - 15 * DAY - HOUR), [
    'warn places Place source data is 15 days old',
  ]);
  // Revisions from before the source date was recorded.
  assert.deepEqual(texts(published(publication({ source: null }))), []);
  // Only the live revision's source counts.
  assert.deepEqual(
    texts(
      published(
        publication({
          revision: 2,
          source: { dataAsOf: now - 30 * DAY, regions: 45 },
        }),
      ),
    ),
    [],
  );
});

void test('a scheduled job without success for twice its interval is late', () => {
  const job = (succeededAt: number | null, intervalMs = HOUR) => ({
    job: 'erase-revoked-athletes',
    intervalMs,
    succeededAt,
  });
  const at = (...jobs: AdminSnapshot['jobs']) => snapshot([user()], { jobs });
  assert.deepEqual(texts(at(job(now - 2 * HOUR), job(null, DAY))), []);
  const late = at(job(now - 3 * HOUR), {
    ...job(now - 3 * DAY, DAY),
    job: 'some-new-job',
  });
  assert.deepEqual(texts(late), [
    'bad system Erase revoked accounts last succeeded 3 h ago, runs hourly',
    'bad system some-new-job last succeeded 3 d ago, runs daily',
  ]);
  assert.deepEqual(tabStates(late).system, {
    tone: 'bad',
    text: 'Strava push registered, 2 jobs late',
  });
  assert.deepEqual([HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * MINUTE].map(every), [
    'hourly',
    'every 6 hours',
    'daily',
    'every 7 days',
    'every 30 min',
  ]);
});

void test('match totals leave out users not counted and earlier re-matches', () => {
  const sum = totals(
    snapshot([
      user(),
      user({ matches: null }),
      user({
        matches: {
          matched: 7,
          rematched: { revision: 2, count: 5 },
          rebuilding: false,
        },
      }),
      user({ active: false }),
    ]),
  );
  assert.deepEqual(
    [sum.matched.count, sum.toMatch.count, sum.rematched.count],
    [17, 20, 8],
  );
});

void test('work in progress is not a problem', () => {
  const value = snapshot([
    user({
      counts: { ...user().counts!, toFetch: 7 },
      ...jobs({ queued: { activities: 1, matches: 4, capped: false } }),
    }),
  ]);
  assert.deepEqual(problems(value), []);
  assert.deepEqual(userState(value.users[0]!, now), {
    tone: 'run',
    text: 'Importing',
  });
  const states = tabStates(value);
  assert.deepEqual(states.activities, {
    tone: 'run',
    text: '10 activities, 7 to fetch',
  });
  assert.deepEqual(states.places, {
    tone: 'run',
    text: 'Revision 3, 4 matches waiting',
  });
});

void test('an elapsed budget window counts nothing', () => {
  const row = { used: 90, limit: 100, blockedUntil: now + HOUR };
  const value = snapshot([], {
    budget: [
      { ...row, key: 'read:15m', windowStart: now - 20 * MINUTE },
      { ...row, key: 'read:day', windowStart: now - HOUR, blockedUntil: null },
    ],
  });
  assert.deepEqual(
    budgetWindows(value).map(({ label, used }) => `${label}: ${used}`),
    ['Reads this quarter hour: 0', 'Reads today: 90'],
  );
  assert.equal(limitedUntil(value), now + HOUR);
  assert.equal(limitedUntil(snapshot([])), null);
});

void test('times read as distances', () => {
  assert.equal(ago(null, now), 'never');
  assert.equal(ago(now + 5, now), 'just now');
  assert.equal(ago(now - 6 * MINUTE, now), '6 min ago');
  assert.equal(ago(now - 31 * HOUR, now), '31 h ago');
  assert.equal(ago(now - 8 * DAY, now), '8 d ago');
  assert.equal(until(now - 1, now), 'due now');
  assert.equal(until(now + 3 * DAY, now), 'in 3 d');
  assert.equal(lastSyncAt(user()), now - HOUR);
  assert.equal(lastSyncAt(user({ lastEventAt: null, sweep: null })), null);
});

void test('a check names its next step', () => {
  const at = (change: object) =>
    nextCheck({ ...user().sweep!, ...change }, now);
  assert.equal(at({}), 'in 2 d');
  assert.equal(at({ running: true }), 'running now');
  assert.equal(at({ dueAt: now - 2 * DAY }), 'due 2 d ago');
  assert.equal(
    at({ phase: 'confirming', dueAt: now + HOUR }),
    'continues in 60 min',
  );
});

void test('what is left of a disconnected user is not counted as work', () => {
  const value = snapshot([
    user({
      active: false,
      counts: { ...user().counts!, toFetch: 7 },
      ...jobs({ queued: { activities: 1, matches: 4, capped: false } }),
    }),
  ]);
  assert.equal(totals(value).toFetch.count, 0);
  assert.equal(totals(value).matchesWaiting.count, 0);
  assert.equal(totals(value).activities.count, 10);
});

void test('a record that belongs to nobody is not a user, whatever its athlete ID', () => {
  const leftover = user({ active: false, hasAccount: false, createdAt: 1 });
  const real = user({ createdAt: 2 });
  const split = withoutLeftovers([leftover, real]);
  assert.deepEqual(split, { users: [real], leftovers: 1 });
  const value = snapshot([], split);
  assert.equal(tabStates(value).users.text, '1 user');
  assert.deepEqual(texts(value), [
    'warn users 1 leftover library record without an account',
  ]);
  assert.equal(problemHref(problems(value)[0]!), '/admin/users');
  // Disconnected users and libraries in use stay.
  for (const kept of [user({ active: false }), user({ hasAccount: false })])
    assert.equal(withoutLeftovers([kept]).leftovers, 0);
});

void test('an athlete ID names the active record when two share it', () => {
  const old = user({ active: false, createdAt: 1 });
  const real = user({ createdAt: 2 });
  assert.equal(userByAthlete([old, real], '42'), real);
  assert.equal(userByAthlete([old], '42'), old);
  assert.equal(userByAthlete([old], '43'), undefined);
});
