import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Shared by standalone proofs and the owned harness: source is identical in both.
export const browserFixtures = {
  presentation: {
    route: 'presentation-test',
    source: `
'use client';
import { Suspense, useEffect } from 'react';
import { StravaConnectProvider, SignedOutConnectPanel } from '~/components/auth/strava-connect';
import { useShallowStore } from '~/store';
function Connection() {
  useEffect(() => { useShallowStore.setState({ isInitialized: true, user: null, isGuest: false }); }, []);
  return <StravaConnectProvider><SignedOutConnectPanel /></StravaConnectProvider>;
}
export default function Review() { return <Suspense><Connection /></Suspense>; }
`,
  },
  list: {
    route: 'list-inspection-test',
    source: `
'use client';
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityListView } from '~/components/list/activity-list';
import { AppSidebar } from '~/components/layout/app-sidebar';
import { AppHeader } from '~/components/layout/app-header';
import { SidebarProvider } from '~/components/ui/sidebar';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { useSelectionReconciliation } from '~/hooks/use-selection-reconciliation';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
const defaults = Object.fromEntries(Object.keys(activityDTOSchema.shape).filter(key => key !== 'streams').map(key => [key, null]));
function FixtureList() {
  const dense = useSearchParams().has('dense');
  const activities = useMemo(() => {
    const raw = dense ? Array.from({length:205}, (_, index) => ({...fixture.activities[0], id:String(index+1), name:'Activity '+String(index+1).padStart(3,'0')})) : fixture.activities;
    return raw.map(item => dtoToActivity(activityDTOSchema.parse({...defaults, ...item})));
  }, [dense]);
  const { filterIDs } = useFilteredActivities(activities);
  useSelectionReconciliation(activities, true, filterIDs);
  return <ActivityListView activities={activities} filterIDs={filterIDs} />;
}
export default function Review() {
  const [client] = useState(() => new QueryClient());
  const [shown, setShown] = useState(true);
  return <Suspense><QueryClientProvider client={client}><SidebarProvider className="flex h-dvh flex-col"><AppHeader /><div className="flex min-h-0 flex-1 overflow-hidden"><AppSidebar /><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><div className="h-14 w-full shrink-0"/><div className="min-h-0 w-full flex-1 overflow-hidden"><button id="test-peer-destination" className="sr-only" onClick={() => setShown(value => !value)}>Switch destination</button>{shown ? <FixtureList /> : <div>Map destination</div>}</div></main></div></SidebarProvider></QueryClientProvider></Suspense>;
}
`,
  },
  stats: {
    route: 'stats-focus-test',
    source: `
'use client';
import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatsTileGrid } from '~/components/stats/tiles';
import { StatsActivityInspector } from '~/components/stats/tiles/activity-inspector';
import { AppSidebar } from '~/components/layout/app-sidebar';
import { AppHeader } from '~/components/layout/app-header';
import { SidebarProvider } from '~/components/ui/sidebar';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { toStatsActivity } from '~/lib/stats/tile-series';
import { dayFromISODate } from '~/lib/stats/tile-data';
import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
const defaults = Object.fromEntries(Object.keys(activityDTOSchema.shape).filter(key => key !== 'streams').map(key => [key, null]));
function FixtureStats() {
  const activities = useMemo(() => fixture.activities.map(item => dtoToActivity(activityDTOSchema.parse({...defaults, ...item}))), []);
  const stats = useMemo(() => activities.map(toStatsActivity), [activities]);
  return <StatsActivityInspector activities={activities}>{(open, detailsOpen, inspection) => <StatsTileGrid {...inspection} activities={stats} reportingDay={dayFromISODate('2026-09-22')} onOpenActivity={open} detailsOpen={detailsOpen} />}</StatsActivityInspector>;
}
export default function Review() {
  const [client] = useState(() => new QueryClient());
  const [shown, setShown] = useState(true);
  return <QueryClientProvider client={client}><SidebarProvider className="flex h-dvh flex-col"><AppHeader /><div className="flex min-h-0 flex-1 overflow-hidden"><AppSidebar /><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><div className="h-14 w-full shrink-0"/><div className="min-h-0 w-full flex-1 overflow-hidden"><button id="test-peer-destination" className="sr-only" onClick={() => setShown(value => !value)}>Switch destination</button>{shown ? <FixtureStats /> : <div>Map destination</div>}</div></main></div></SidebarProvider></QueryClientProvider>;
}
`,
  },
  account: {
    route: 'account-deletion-test',
    source: `
'use client';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsDialog } from '~/components/settings/settings-dialog';
import { OfflineSyncProvider } from '~/components/providers/offline-sync';
import { useShallowStore } from '~/store';
import { upsertActivityDTOs, getCachedActivityDTOs, setV1SyncState } from '~/lib/sync/v1-store';
import { activityDTOSchema } from '~/contracts/v1/activity';
import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
export default function Review() {
  const [client] = useState(() => new QueryClient());
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    void (async () => {
      const defaults = Object.fromEntries(Object.keys(activityDTOSchema.shape).filter(key => key !== 'streams').map(key => [key, null]));
      const activity = activityDTOSchema.parse({...defaults, ...fixture.activities[0]});
      await upsertActivityDTOs('auth:deletion-fixture', [activity]);
      await setV1SyncState({scope:'auth:deletion-fixture',bootstrapCursor:'fixture',bootstrapComplete:true,changesCursor:'fixture',lastSyncAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      useShallowStore.getState().initializeAuth({currentUser:{id:'deletion-fixture',name:'Deletion fixture',email:null,image:null,athlete_id:42,stravaConnected:true}} as never);
      (window as any).__deletionProof = { cached: () => getCachedActivityDTOs('auth:deletion-fixture'), user: () => useShallowStore.getState().user };
      setReady(true);
    })();
  }, []);
  return <QueryClientProvider client={client}>{ready && <><OfflineSyncProvider/><SettingsDialog open={open} onOpenChange={setOpen}/></>}</QueryClientProvider>;
}
`,
  },
};

export async function createBrowserFixture(root, name, owner) {
  const fixture = browserFixtures[name];
  assert(fixture, `Unknown browser fixture: ${name}`);
  const route = join(root, 'src/app', fixture.route);
  await mkdir(route); // Refuse any preexisting developer fixture.
  try {
    await writeFile(join(route, 'page.tsx'), fixture.source, { flag: 'wx' });
    if (owner)
      await writeFile(join(route, '.quality-owner'), owner, { flag: 'wx' });
    return route;
  } catch (error) {
    // mkdir succeeded, so this call owns the partial fixture and may remove it.
    await rm(route, { recursive: true, force: true });
    throw error;
  }
}

export async function prepareBrowserFixture(root, name) {
  const owner = process.env.QUALITY_FIXTURE_OWNER;
  if (!owner) return createBrowserFixture(root, name);
  const fixture = browserFixtures[name];
  assert(fixture, `Unknown browser fixture: ${name}`);
  const route = join(root, 'src/app', fixture.route);
  assert.equal(
    await readFile(join(route, '.quality-owner'), 'utf8'),
    owner,
    'Refusing a fixture not created by this harness run',
  );
  assert.equal(
    await readFile(join(route, 'page.tsx'), 'utf8'),
    fixture.source,
    'Refusing a modified prepared fixture',
  );
  return route;
}

export async function cleanupBrowserFixture(root, name) {
  // Prepared routes must stay mounted through all scenarios: deleting one can
  // refresh shared app modules in another tab. The wrapper removes its copy.
  if (process.env.QUALITY_FIXTURE_OWNER) return;
  const fixture = browserFixtures[name];
  assert(fixture, `Unknown browser fixture: ${name}`);
  await rm(join(root, 'src/app', fixture.route), {
    recursive: true,
    force: true,
  });
  await rm(join(root, '.next/dev/types/app', fixture.route), {
    recursive: true,
    force: true,
  });
}
