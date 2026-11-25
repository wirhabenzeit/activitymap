import type { AdminSnapshot, AdminUser } from '~/server/admin/contract';

/**
 * What the operator dashboard says about a snapshot: the problems, and each
 * user's state. Pure, so every rule has a test.
 */

export type Tone = 'ok' | 'run' | 'warn' | 'bad' | 'off';
export type AdminTab = 'users' | 'activities' | 'places' | 'system';
export type Problem = {
  tone: 'warn' | 'bad';
  text: string;
  /** The tab that shows it. */
  tab: AdminTab;
  /** The user it concerns. */
  athleteId?: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Strava data is read again within seven days (docs/strava-data-policy.md). */
const LIST_LIMIT_MS = 7 * DAY;
const SWEEP_LATE_MS = HOUR;
/** A large re-match keeps jobs waiting for a while without being stuck. */
const JOB_LATE_MS = 30 * MINUTE;
const APPLY_LIMIT_MS = 2 * HOUR;
const ERASURE_LATE_MS = DAY;

const REASONS: Record<string, string> = {
  rate_limited: 'Strava request limit',
  lease_expired: 'run was lost',
  fenced: 'handed to another writer',
  foreign_activity: 'belongs to another athlete',
  invalid_response: 'Strava sent an invalid answer',
  not_found: 'not found at Strava',
  forbidden: 'Strava refused access',
  credentials_rejected: 'Strava rejected the credentials',
  upstream_error: 'Strava error',
  gateway_not_configured: 'provider gateway not configured',
  tile_budget: 'route spans too many map tiles',
  other: 'other error, see the Convex dashboard',
};
export const reasonText = (code: string) => REASONS[code] ?? REASONS.other!;

export function ago(time: number | null, now: number) {
  if (time === null) return 'never';
  const minutes = Math.max(0, Math.round((now - time) / MINUTE));
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** A sweep's next step: a scan or a confirmation walk under way has one too. */
export function nextCheck(sweep: NonNullable<AdminUser['sweep']>, now: number) {
  if (sweep.running) return 'running now';
  if (sweep.dueAt <= now) return `due ${ago(sweep.dueAt, now)}`;
  return `${sweep.phase === 'idle' ? '' : 'continues '}${until(sweep.dueAt, now)}`;
}

export function until(time: number, now: number) {
  if (time <= now) return 'due now';
  const minutes = Math.max(1, Math.round((time - now) / MINUTE));
  if (minutes < 90) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} d`;
}

export const clock = (time: number) =>
  `${new Date(time).toISOString().slice(11, 16)} UTC`;

export const number = (value: number) => value.toLocaleString('en-US');

/** A capped count reads "250+". */
export const atLeast = (value: number, capped: boolean) =>
  `${number(value)}${capped ? '+' : ''}`;

const days = (ms: number) => {
  const value = Math.floor(ms / DAY);
  return `${value} ${value === 1 ? 'day' : 'days'}`;
};

/** The latest sign of contact with Strava: an event, or a complete read of
 * the user's activity list. */
export function lastSyncAt(user: AdminUser) {
  const times = [user.lastEventAt, user.sweep?.listReadAt ?? null].filter(
    (time) => time !== null,
  );
  return times.length ? Math.max(...times) : null;
}

/** Nothing is fetched or matched for such a user, whatever is left. */
export const disconnected = (user: AdminUser) =>
  user.revokedAt !== null || !user.active;

/**
 * Set apart the library records that belong to nobody: inactive and without
 * a sign-in record. They are no users, and one can share its athlete ID with
 * a real library (records are keyed by user ID).
 */
export function withoutLeftovers(records: readonly AdminUser[]) {
  const users = records.filter((user) => user.active || user.hasAccount);
  return { users, leftovers: records.length - users.length };
}

/** The user an athlete ID names: the active one if two records share it. */
export function userByAthlete(users: readonly AdminUser[], athleteId: string) {
  const found = users.filter((user) => user.athleteId === athleteId);
  return found.find((user) => user.active) ?? found[0];
}

export const mustReconnect = (user: AdminUser) =>
  !disconnected(user) &&
  (user.jobs.blocked.activities + user.jobs.blocked.matches > 0 ||
    user.sweep?.error === 'credentials_rejected');

export function userProblems(user: AdminUser, now: number): Problem[] {
  const { athleteId, sweep, jobs } = user;
  const problem = (
    tone: Problem['tone'],
    tab: AdminTab,
    text: string,
  ): Problem => ({ tone, tab, text, athleteId });
  const found: Problem[] = [];
  if (user.erasureDueAt !== null && now - user.erasureDueAt > ERASURE_LATE_MS)
    found.push(
      problem(
        'bad',
        'users',
        `Erasure overdue by ${days(now - user.erasureDueAt)}`,
      ),
    );
  if (disconnected(user)) return found;

  const reconnect = mustReconnect(user);
  const readAt = sweep?.listReadAt ?? user.createdAt;
  if (now - readAt > LIST_LIMIT_MS)
    found.push(
      problem(
        'bad',
        'users',
        `Strava list not read for ${days(now - readAt)} (limit 7 days)`,
      ),
    );
  else if (!sweep)
    found.push(problem('bad', 'users', 'No reconciliation scheduled'));
  if (sweep && !sweep.running && now - sweep.dueAt > SWEEP_LATE_MS)
    found.push(
      problem('bad', 'users', `Full check due ${ago(sweep.dueAt, now)}`),
    );
  if (jobs.oldestDueAt !== null && now - jobs.oldestDueAt > JOB_LATE_MS)
    found.push(
      problem(
        'bad',
        'activities',
        `Queued work due ${ago(jobs.oldestDueAt, now)} has not run`,
      ),
    );
  if (reconnect)
    found.push(problem('warn', 'users', 'Must reconnect to Strava'));
  const { failed } = jobs;
  if (failed.activities > 0)
    found.push(
      problem(
        'warn',
        'activities',
        `${atLeast(failed.activities, failed.capped)} activities failed`,
      ),
    );
  if (failed.matches > 0)
    found.push(
      problem(
        'warn',
        'places',
        `${atLeast(failed.matches, failed.capped)} place matches failed`,
      ),
    );
  return found;
}

export function problems(snapshot: AdminSnapshot): Problem[] {
  const now = snapshot.observedAt;
  const found = snapshot.users.flatMap((user) => userProblems(user, now));
  const pending = snapshot.catalogue?.pending;
  if (pending && now - pending.startedAt > APPLY_LIMIT_MS)
    found.push({
      tone: 'warn',
      tab: 'places',
      text: `Catalogue revision ${pending.revision} begun ${ago(pending.startedAt, now)} and not completed`,
    });
  if (snapshot.leftovers > 0)
    found.push({
      tone: 'warn',
      tab: 'users',
      text: `${number(snapshot.leftovers)} leftover library ${snapshot.leftovers === 1 ? 'record' : 'records'} without an account`,
    });
  if (snapshot.subscription === 'missing')
    found.push({
      tone: 'bad',
      tab: 'system',
      text: 'No Strava push subscription for this deployment',
    });
  return [
    ...found.filter((item) => item.tone === 'bad'),
    ...found.filter((item) => item.tone === 'warn'),
  ];
}

export const problemHref = ({ tab, athleteId }: Problem) =>
  athleteId ? `/admin/users/${athleteId}` : `/admin/${tab}`;

export function worst(tones: readonly Tone[]): Tone {
  for (const tone of ['bad', 'warn', 'run', 'ok'] as const)
    if (tones.includes(tone)) return tone;
  return 'off';
}

/** A user's state in a word or two. */
export function userState(
  user: AdminUser,
  now: number,
): { tone: Tone; text: string } {
  const found = userProblems(user, now);
  const tone = worst(found.map((item) => item.tone));
  if (disconnected(user))
    return {
      tone,
      text: user.erasureDueAt === null ? 'Disconnected' : 'Awaiting erasure',
    };
  if (tone === 'bad')
    return {
      tone,
      text: found.some((item) => item.tone === 'bad' && item.tab === 'users')
        ? 'Check overdue'
        : 'Work stuck',
    };
  if (mustReconnect(user)) return { tone: 'warn', text: 'Must reconnect' };
  if (tone === 'warn') return { tone, text: 'Failures' };
  const { queued } = user.jobs;
  if ((user.counts?.toFetch ?? 0) > 0)
    return { tone: 'run', text: 'Importing' };
  if (queued.activities + queued.matches > 0)
    return { tone: 'run', text: 'Working' };
  return { tone: 'ok', text: 'Connected' };
}

/** A figure summed over users, and whether a capped count is in it. */
function total(
  users: readonly AdminUser[],
  of: (user: AdminUser) => number,
  capped: (user: AdminUser) => boolean = () => false,
) {
  return {
    count: users.reduce((sum, user) => sum + of(user), 0),
    capped: users.some((user) => of(user) > 0 && capped(user)),
  };
}

export function totals({ users }: AdminSnapshot) {
  const connected = users.filter((user) => !disconnected(user));
  return {
    activities: total(users, (user) => user.counts?.activities ?? 0),
    recordings: total(users, (user) => user.counts?.recordings ?? 0),
    photos: total(users, (user) => user.counts?.photos ?? 0),
    toFetch: total(connected, (user) => user.counts?.toFetch ?? 0),
    failed: total(
      connected,
      (user) => user.jobs.failed.activities + user.jobs.blocked.activities,
      (user) => user.jobs.failed.capped || user.jobs.blocked.capped,
    ),
    matchesWaiting: total(
      connected,
      (user) => user.jobs.queued.matches,
      (user) => user.jobs.queued.capped,
    ),
    matchesFailed: total(
      connected,
      (user) => user.jobs.failed.matches + user.jobs.blocked.matches,
      (user) => user.jobs.failed.capped || user.jobs.blocked.capped,
    ),
  };
}

/** The four tabs' one-line summaries and tones. */
export function tabStates(
  snapshot: AdminSnapshot,
): Record<AdminTab, { tone: Tone; text: string }> {
  const found = problems(snapshot);
  const sum = totals(snapshot);
  const tone = (tab: AdminTab, otherwise: Tone) => {
    const own = found.filter((item) => item.tab === tab);
    return own.length ? worst(own.map((item) => item.tone)) : otherwise;
  };
  const show = ({ count, capped }: { count: number; capped: boolean }) =>
    atLeast(count, capped);
  const { catalogue, users } = snapshot;
  const affected = new Set(found.flatMap((item) => item.athleteId ?? [])).size;
  const userCount = `${number(users.length)} ${users.length === 1 ? 'user' : 'users'}`;
  const matching =
    sum.matchesWaiting.count > 0 || (catalogue?.tilesLeft.count ?? 0) > 0;
  return {
    users: {
      tone: tone('users', 'ok'),
      text: affected ? `${userCount}, ${affected} with problems` : userCount,
    },
    activities: {
      tone: tone(
        'activities',
        sum.failed.count > 0 ? 'warn' : sum.toFetch.count > 0 ? 'run' : 'ok',
      ),
      text: [
        `${show(sum.activities)} activities`,
        sum.toFetch.count > 0 && `${show(sum.toFetch)} to fetch`,
        sum.failed.count > 0 && `${show(sum.failed)} failed or blocked`,
      ]
        .filter(Boolean)
        .join(', '),
    },
    places: {
      tone: tone('places', !catalogue ? 'off' : matching ? 'run' : 'ok'),
      text: !catalogue
        ? 'No catalogue published'
        : `Revision ${catalogue.revision}, ${
            sum.matchesWaiting.count > 0
              ? `${show(sum.matchesWaiting)} matches waiting`
              : matching
                ? 'checking changed areas'
                : 'nothing waiting'
          }`,
    },
    system: {
      tone: tone(
        'system',
        snapshot.subscription === 'registered' ? 'ok' : 'off',
      ),
      text: {
        registered: 'Strava push registered',
        missing: 'Strava push not registered',
        unknown: 'Strava push not checked',
        not_managed: 'Strava push not managed here',
      }[snapshot.subscription],
    },
  };
}

/** When Strava's request limit is what work waits for: until when. */
export function limitedUntil({ budget, observedAt }: AdminSnapshot) {
  const times = budget.flatMap(({ blockedUntil }) =>
    blockedUntil !== null && blockedUntil > observedAt ? [blockedUntil] : [],
  );
  return times.length ? Math.max(...times) : null;
}

const WINDOWS = [
  { key: 'overall:15m', label: 'Requests this quarter hour', ms: 15 * MINUTE },
  { key: 'read:15m', label: 'Reads this quarter hour', ms: 15 * MINUTE },
  { key: 'overall:day', label: 'Requests today', ms: DAY },
  { key: 'read:day', label: 'Reads today', ms: DAY },
];

/** The request budget's windows. A row of an elapsed window counts nothing. */
export function budgetWindows({ budget, observedAt }: AdminSnapshot) {
  return WINDOWS.flatMap(({ key, label, ms }) => {
    const row = budget.find((item) => item.key === key);
    if (!row) return [];
    const current = row.windowStart + ms > observedAt;
    return [
      {
        label,
        used: current ? row.used : 0,
        limit: row.limit,
        blockedUntil:
          row.blockedUntil !== null && row.blockedUntil > observedAt
            ? row.blockedUntil
            : null,
      },
    ];
  });
}
