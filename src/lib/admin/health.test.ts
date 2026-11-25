import assert from 'node:assert/strict';

import test from 'node:test';

import type { AdminSnapshot, AdminUser } from '~/server/admin/contract';

import {
  ago,
  budgetWindows,
  lastSyncAt,
  limitedUntil,
  nextCheck,
  problemHref,
  problems,
  tabStates,
  totals,
  until,
  userState,
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
    revokedAt: null,
    erasureDueAt: null,
    counts: {
      activities: 10,
      recordings: 10,
      photos: 3,
      toFetch: 0,
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
    },
    budget: [],
    subscription: 'registered',
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
