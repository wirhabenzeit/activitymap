'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { SelectionBar } from '~/components/activity-selection-controls';
import { AppHeader } from '~/components/layout/app-header';
import { ActivityListView } from '~/components/list/activity-list';
import { ActivityCardContent } from '~/components/list/card';
import { SidebarProvider } from '~/components/ui/sidebar';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { upsertActivityDTOs } from '~/lib/sync/v1-store';
import { store } from '~/store';

import fixture from '../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';

const defaults = Object.fromEntries(
  Object.keys(activityDTOSchema.shape)
    .filter((key) => key !== 'streams')
    .map((key) => [key, null]),
);
const dtos = Array.from({ length: 205 }, (_, index) =>
  activityDTOSchema.parse({
    ...defaults,
    ...fixture.activities[index % 5],
    id: String(index + 1),
    name: `Activity ${index + 1}`,
  }),
);

function MapResults({ detailID }: { detailID: number }) {
  const activities = useMemo(() => dtos.map(dtoToActivity), []);
  const detail = activities.find((activity) => activity.id === detailID);
  return (
    <>
      <SelectionBar
        filterIDs={activities.map((activity) => activity.id)}
        showShare={!detail}
      />
      {detail ? (
        <ActivityCardContent activity={detail} showMapButton={false} />
      ) : (
        <p>Four map results</p>
      )}
    </>
  );
}

function SharingFixture() {
  const [ready, setReady] = useState(false);
  const [surface, setSurface] = useState<'map' | 'list'>('map');
  const [detailID, setDetailID] = useState(0);
  const activities = useMemo(() => dtos.map(dtoToActivity), []);
  useEffect(() => {
    void (async () => {
      await upsertActivityDTOs('auth:sharing-review', dtos);
      store.getState().initializeAuth({
        currentUser: {
          id: 'sharing-review',
          name: 'Sharing review',
          email: null,
          image: null,
          athleteId: 42,
          stravaConnected: true,
          stravaPermissions: null,
        },
      });
      store.getState().reconcileSelection(
        activities.map((a) => a.id),
        activities.map((a) => a.id),
      );
      store.getState().pickActivities([1, 2, 3, 4]);
      setReady(true);
    })();
  }, [activities]);
  if (!ready) return null;
  return (
    <div data-sharing-ready className="flex h-dvh flex-col pt-14">
      <AppHeader />
      <div className="flex shrink-0 flex-wrap gap-2 p-2">
        <button onClick={() => setDetailID(2)}>Open map detail 2</button>
        <button onClick={() => setDetailID(0)}>Close map detail</button>
        <button onClick={() => store.getState().setCombineSelections(true)}>
          Enable Combine
        </button>
        <button onClick={() => store.getState().setCombineSelections(false)}>
          Disable Combine
        </button>
        <button onClick={() => store.getState().clearSelection()}>
          Clear group
        </button>
        <button
          id="change-selection"
          onClick={() => store.getState().setSelected([1, 3, 4, 5])}
        >
          Change selection
        </button>
        <button onClick={() => store.getState().setSelected([1, 2, 3, 4])}>
          Restore selection
        </button>
        <button onClick={() => setSurface(surface === 'list' ? 'map' : 'list')}>
          Switch surface
        </button>
        <button onClick={() => store.setState({ isGuest: true })}>
          Become guest
        </button>
      </div>
      <main className="min-h-0 flex-1 overflow-auto">
        {surface === 'map' ? (
          <MapResults detailID={detailID} />
        ) : (
          <ActivityListView
            activities={activities}
            filterIDs={activities.map((a) => a.id)}
          />
        )}
      </main>
    </div>
  );
}

export default function SharingReview() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <Suspense>
      <QueryClientProvider client={client}>
        <SidebarProvider>
          <SharingFixture />
        </SidebarProvider>
      </QueryClientProvider>
    </Suspense>
  );
}
