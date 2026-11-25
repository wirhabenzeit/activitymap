import Link from 'next/link';

import {
  type Problem,
  ago,
  atLeast,
  budgetWindows,
  clock,
  date,
  disconnected,
  every,
  jobLate,
  jobName,
  lastSyncAt,
  limitedUntil,
  livePublication,
  nextCheck,
  number,
  problemHref,
  problems,
  pushState,
  reasonText,
  rematchProgress,
  tabStates,
  totals,
  until,
  userProblems,
  userState,
} from '~/lib/admin/health';
import type { AdminSnapshot, AdminUser } from '~/server/admin/contract';

import { Box, Figures, Mark, Meter, Row, Section, State } from './parts';

type Props = { snapshot: AdminSnapshot };

/** Athlete IDs need not be unique among library records. */
const userKey = (user: AdminUser) => `${user.athleteId}-${user.createdAt}`;
const userHref = (user: AdminUser) => `/admin/users/${user.athleteId}`;

function ProblemRow({
  problem,
  linked,
}: {
  problem: Problem;
  linked: boolean;
}) {
  return (
    <Row
      href={linked ? problemHref(problem) : undefined}
      label={
        <span className="inline-flex items-baseline gap-2.5">
          <Mark tone={problem.tone} />
          <span>
            <span className="sr-only">
              {problem.tone === 'bad' ? 'Problem: ' : 'Warning: '}
            </span>
            {linked && problem.athleteId
              ? `Athlete ${problem.athleteId}: ${problem.text}`
              : problem.text}
          </span>
        </span>
      }
    />
  );
}

export function OverviewView({ snapshot }: Props) {
  const found = problems(snapshot);
  const states = tabStates(snapshot);
  const tabs = [
    ['users', 'Users'],
    ['activities', 'Activities'],
    ['places', 'Places'],
    ['system', 'System'],
  ] as const;
  return (
    <>
      <Section>
        <Box>
          {found.length === 0 ? (
            <Row label={<State tone="ok">No problems</State>} />
          ) : (
            found.map((problem, index) => (
              <ProblemRow key={index} problem={problem} linked />
            ))
          )}
        </Box>
      </Section>
      <Section>
        <Box>
          {tabs.map(([tab, label]) => (
            <Row
              key={tab}
              href={`/admin/${tab}`}
              label={<State tone={states[tab].tone}>{label}</State>}
              value={states[tab].text}
            />
          ))}
        </Box>
      </Section>
    </>
  );
}

export function UsersView({ snapshot }: Props) {
  const now = snapshot.observedAt;
  const { leftovers } = snapshot;
  const cell = 'px-3.5 py-2.5 max-sm:px-2.5';
  return (
    <>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className={`${cell} font-medium`}>Athlete</th>
              <th className={`${cell} font-medium`}>State</th>
              <th className={`${cell} text-right font-medium max-sm:hidden`}>
                Activities
              </th>
              <th className={`${cell} text-right font-medium`}>Last sync</th>
            </tr>
          </thead>
          <tbody className="divide-y border-t">
            {snapshot.users.map((user) => {
              const state = userState(user, now);
              return (
                <tr key={userKey(user)}>
                  <td className={cell}>
                    <Link
                      href={userHref(user)}
                      prefetch={false}
                      className="underline underline-offset-4"
                    >
                      {user.athleteId}
                    </Link>
                  </td>
                  <td className={cell}>
                    <State tone={state.tone}>{state.text}</State>
                  </td>
                  <td className={`${cell} text-right max-sm:hidden`}>
                    {user.counts ? number(user.counts.activities) : '–'}
                  </td>
                  <td className={`${cell} text-right text-muted-foreground`}>
                    {ago(lastSyncAt(user), now)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {leftovers > 0 && (
        <p className="text-sm text-muted-foreground">
          {number(leftovers)} more library{' '}
          {leftovers === 1 ? 'record is' : 'records are'} inactive, without an
          account. Erase with <code>erasure:start</code> on the Convex backend.
        </p>
      )}
    </>
  );
}

export function UserView({ snapshot, user }: Props & { user: AdminUser }) {
  const now = snapshot.observedAt;
  const state = userState(user, now);
  const found = userProblems(user, now);
  const { counts, jobs, matches, sweep } = user;
  const waiting = (value: number) => atLeast(value, jobs.queued.capped);
  const given = (value: number | undefined) =>
    value === undefined ? '–' : number(value);
  const reasons = (stage: 'activities' | 'matches') =>
    jobs.reasons
      .filter((reason) => reason.stage === stage)
      .map((reason) => (
        <Row
          key={reason.code}
          label={
            <span className="text-muted-foreground">
              {reasonText(reason.code)}
            </span>
          }
          value={number(reason.count)}
        />
      ));
  return (
    <>
      <div className="space-y-3">
        <Link
          href="/admin/users"
          prefetch={false}
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          All users
        </Link>
        <h2 className="text-xl font-semibold">Athlete {user.athleteId}</h2>
        {found.length > 0 && (
          <Box>
            {found.map((problem, index) => (
              <ProblemRow key={index} problem={problem} linked={false} />
            ))}
          </Box>
        )}
      </div>
      <Section title="Account">
        <Box>
          <Row
            label="State"
            value={<State tone={state.tone}>{state.text}</State>}
          />
          <Row label="Last sync" value={ago(lastSyncAt(user), now)} />
          <Row
            label="Strava list last read"
            value={ago(sweep?.listReadAt ?? null, now)}
          />
          {sweep && user.active && (
            <Row label="Next full check" value={nextCheck(sweep, now)} />
          )}
          {sweep?.error && (
            <Row label="Last full check" value={reasonText(sweep.error)} />
          )}
          {user.erasureDueAt !== null && (
            <Row label="Erasure" value={until(user.erasureDueAt, now)} />
          )}
        </Box>
      </Section>
      <Section title="Activities">
        <Box>
          <Row label="Activities" value={given(counts?.activities)} />
          <Row label="Recordings" value={given(counts?.recordings)} />
          <Row label="Photos" value={given(counts?.photos)} />
          <Row label="Still to fetch" value={given(counts?.toFetch)} />
          <Row label="Queued" value={waiting(jobs.queued.activities)} />
          <Row
            label="Failed or blocked"
            value={atLeast(
              jobs.failed.activities + jobs.blocked.activities,
              jobs.failed.capped || jobs.blocked.capped,
            )}
          />
          {reasons('activities')}
          {counts?.rebuilding && <Row label="Counts are being rebuilt" />}
        </Box>
      </Section>
      <Section title="Place matches">
        <Box>
          <Row label="Matched" value={given(matches?.matched)} />
          <Row label="Waiting" value={waiting(jobs.queued.matches)} />
          <Row
            label="Failed"
            value={atLeast(
              jobs.failed.matches + jobs.blocked.matches,
              jobs.failed.capped || jobs.blocked.capped,
            )}
          />
          {reasons('matches')}
          {matches?.rebuilding && <Row label="Matches are being recounted" />}
        </Box>
      </Section>
    </>
  );
}

/** The users a stage has not finished for. Absent when there are none. */
function Unfinished({
  users,
  text,
}: {
  users: AdminUser[];
  text: (user: AdminUser) => string[];
}) {
  const rows = users.flatMap((user) => {
    const parts = disconnected(user) ? [] : text(user);
    return parts.length ? [{ user, value: parts.join(', ') }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <Section title="Not finished">
      <Box>
        {rows.map(({ user, value }) => (
          <Row
            key={userKey(user)}
            href={userHref(user)}
            label={user.athleteId}
            value={value}
          />
        ))}
      </Box>
    </Section>
  );
}

export function ActivitiesView({ snapshot }: Props) {
  const sum = totals(snapshot);
  const limited = limitedUntil(snapshot);
  return (
    <>
      <Figures
        items={[
          [number(sum.activities.count), 'activities'],
          [number(sum.recordings.count), 'recordings'],
          [number(sum.photos.count), 'photos'],
          [number(sum.toFetch.count), 'to fetch'],
          [atLeast(sum.failed.count, sum.failed.capped), 'failed or blocked'],
        ]}
      />
      <Unfinished
        users={snapshot.users}
        text={({ counts, jobs }) => [
          ...(counts?.toFetch ? [`${number(counts.toFetch)} to fetch`] : []),
          ...(jobs.failed.activities
            ? [`${atLeast(jobs.failed.activities, jobs.failed.capped)} failed`]
            : []),
          ...(jobs.blocked.activities
            ? [
                `${atLeast(jobs.blocked.activities, jobs.blocked.capped)} blocked`,
              ]
            : []),
        ]}
      />
      <Section title="Strava">
        <Box>
          <Row
            label="Last event"
            value={ago(snapshot.lastEventAt, snapshot.observedAt)}
          />
          {limited !== null && (
            <Row
              href="/admin/system"
              label={
                <State tone="run">Waiting for Strava’s request limit</State>
              }
              value={`until ${clock(limited)}`}
            />
          )}
        </Box>
      </Section>
    </>
  );
}

export function PlacesView({ snapshot }: Props) {
  const { catalogue, observedAt: now } = snapshot;
  const sum = totals(snapshot);
  if (!catalogue)
    return (
      <Box>
        <Row label="No catalogue has been published" />
      </Box>
    );
  const { tilesLeft, publications } = catalogue;
  const live = livePublication(snapshot);
  const progress = rematchProgress(snapshot);
  return (
    <>
      <Section title="Live catalogue">
        <Figures
          items={[
            [
              `Revision ${catalogue.revision}`,
              live?.completedAt ? `since ${date(live.completedAt)}` : 'live',
            ],
            [number(catalogue.places), 'places'],
            [live?.source ? date(live.source.dataAsOf) : '–', 'source data'],
          ]}
        />
      </Section>
      {catalogue.pending && (
        <Box>
          <Row
            label={
              <State tone="run">
                Revision {catalogue.pending.revision} is being applied
              </State>
            }
            value={`begun ${ago(catalogue.pending.startedAt, now)}`}
          />
        </Box>
      )}
      <Section title="Re-matching">
        <Box>
          {progress && progress.total > 0 ? (
            <Meter
              label="Changed areas checked"
              used={progress.done}
              limit={progress.total}
            />
          ) : (
            <Row
              label="Changed areas"
              value={
                tilesLeft.count > 0
                  ? `${atLeast(tilesLeft.count, tilesLeft.capped)} left to check`
                  : 'all checked'
              }
            />
          )}
          {live && (
            <Row
              label={`Activities re-matched for revision ${live.revision}`}
              value={number(sum.rematched.count)}
            />
          )}
          {sum.toMatch.count > 0 && (
            <Meter
              label="Recordings matched"
              used={sum.matched.count}
              limit={sum.toMatch.count}
            />
          )}
          <Row
            label="Matches waiting"
            value={atLeast(sum.matchesWaiting.count, sum.matchesWaiting.capped)}
          />
          <Row
            label="Matches failed"
            value={atLeast(sum.matchesFailed.count, sum.matchesFailed.capped)}
          />
        </Box>
      </Section>
      <Unfinished
        users={snapshot.users}
        text={({ jobs }) => {
          const failed = jobs.failed.matches + jobs.blocked.matches;
          return [
            ...(jobs.queued.matches
              ? [`${atLeast(jobs.queued.matches, jobs.queued.capped)} waiting`]
              : []),
            ...(failed
              ? [
                  `${atLeast(failed, jobs.failed.capped || jobs.blocked.capped)} failed`,
                ]
              : []),
          ];
        }}
      />
      {publications.length > 0 && (
        <Section title="Publications">
          <Box>
            {publications.map(({ revision, completedAt, source }) => (
              <Row
                key={revision}
                label={`Revision ${revision}`}
                value={[
                  completedAt === null ? 'being applied' : date(completedAt),
                  source &&
                    `${number(source.regions)} ${source.regions === 1 ? 'region' : 'regions'}`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              />
            ))}
          </Box>
        </Section>
      )}
    </>
  );
}

export function SystemView({
  snapshot,
  controls,
}: Props & { controls: React.ReactNode }) {
  const push = pushState(snapshot);
  const windows = budgetWindows(snapshot);
  const now = snapshot.observedAt;
  return (
    <>
      <Section title="Strava push subscription">
        <Box>
          <Row label={<State tone={push.tone}>{push.text}</State>} />
          {controls}
        </Box>
      </Section>
      <Section title="Strava request budget">
        <Box>
          {windows.length === 0 ? (
            <Row label="No requests recorded" />
          ) : (
            windows.map(({ label, used, limit, blockedUntil }) => (
              <Meter
                key={label}
                label={label}
                used={used}
                limit={limit}
                note={
                  blockedUntil === null
                    ? undefined
                    : `Blocked until ${clock(blockedUntil)}`
                }
              />
            ))
          )}
        </Box>
      </Section>
      <Section title="Scheduled jobs">
        <Box>
          {snapshot.jobs.length === 0 ? (
            <Row label="Not recorded by this backend" />
          ) : (
            snapshot.jobs.map((job) => (
              <Row
                key={job.job}
                label={
                  <State
                    tone={
                      jobLate(job, now)
                        ? 'bad'
                        : job.succeededAt === null
                          ? 'off'
                          : 'ok'
                    }
                  >
                    {jobName(job.job)}
                  </State>
                }
                value={`${every(job.intervalMs)}, ${
                  job.succeededAt === null
                    ? 'no success recorded'
                    : `last success ${ago(job.succeededAt, now)}`
                }`}
              />
            ))
          )}
        </Box>
      </Section>
    </>
  );
}
