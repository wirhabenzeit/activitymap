import Link from 'next/link';

import {
  type Problem,
  ago,
  atLeast,
  budgetWindows,
  clock,
  disconnected,
  lastSyncAt,
  limitedUntil,
  nextCheck,
  number,
  problemHref,
  problems,
  reasonText,
  tabStates,
  totals,
  until,
  userProblems,
  userState,
} from '~/lib/admin/health';
import type { AdminSnapshot, AdminUser } from '~/server/admin/contract';

import { Box, Figures, Mark, Meter, Row, Section, State } from './parts';

type Props = { snapshot: AdminSnapshot };

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
  const cell = 'px-3.5 py-2.5 max-sm:px-2.5';
  return (
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
              <tr key={user.athleteId}>
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
  );
}

export function UserView({ snapshot, user }: Props & { user: AdminUser }) {
  const now = snapshot.observedAt;
  const state = userState(user, now);
  const found = userProblems(user, now);
  const { counts, jobs, sweep } = user;
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
          <Row label="Waiting" value={waiting(jobs.queued.matches)} />
          <Row
            label="Failed"
            value={atLeast(
              jobs.failed.matches + jobs.blocked.matches,
              jobs.failed.capped || jobs.blocked.capped,
            )}
          />
          {reasons('matches')}
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
            key={user.athleteId}
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
  const { tilesLeft } = catalogue;
  return (
    <>
      <Section title="Live catalogue">
        <Figures
          items={[
            [`Revision ${catalogue.revision}`, 'live'],
            [number(catalogue.places), 'places'],
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
          <Row
            label={
              <State tone={tilesLeft.count > 0 ? 'run' : 'ok'}>
                Changed areas
              </State>
            }
            value={
              tilesLeft.count > 0
                ? `${atLeast(tilesLeft.count, tilesLeft.capped)} left to check`
                : 'all checked'
            }
          />
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
    </>
  );
}

export function SystemView({
  snapshot,
  controls,
}: Props & { controls: React.ReactNode }) {
  const { system } = tabStates(snapshot);
  const windows = budgetWindows(snapshot);
  return (
    <>
      <Section title="Strava push subscription">
        <Box>
          <Row label={<State tone={system.tone}>{system.text}</State>} />
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
    </>
  );
}
