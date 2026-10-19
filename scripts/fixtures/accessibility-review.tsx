'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  ClearSelectionButton,
  CombineSelectionButton,
} from '~/components/activity-selection-controls';
import { CategoryFilter } from '~/components/layout/sidebar/filters';
import { ActivityCardContent } from '~/components/list/card';
import { SidebarProvider } from '~/components/ui/sidebar';
import { Toaster } from '~/components/ui/toaster';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { useLibrarySnapshot } from '~/hooks/use-library-snapshot';
import { registerLibrarySync } from '~/lib/sync/library-sync';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { upsertActivityDTOs } from '~/lib/sync/v1-store';
import { store } from '~/store';

import fixture from '../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';

const defaults = Object.fromEntries(
  Object.keys(activityDTOSchema.shape)
    .filter((key) => key !== 'streams')
    .map((key) => [key, null]),
);
const source = activityDTOSchema.parse({
  ...defaults,
  ...fixture.activities[0],
  name: 'Morning route — user title',
  description: 'User description with line breaks.\nSecond recorded line.',
});
const scope = 'auth:accessibility-review';

function Surface({ client }: { client: QueryClient }) {
  const library = useLibrarySnapshot();
  const [ready, setReady] = useState(false);
  const [commands, setCommands] = useState(0);
  const [cacheFailures, setCacheFailures] = useState(0);
  const failCache = useRef(false);
  useEffect(() => {
    store.getState().initializeAuth({
      currentUser: {
        id: 'accessibility-review',
        name: 'Review fixture',
        email: null,
        image: null,
        athleteId: 42,
        stravaPermissions: null,
        stravaConnected: true,
      },
    });
    store.setState({ selected: [Number(source.id)], combineSelections: true });
    const unregister = registerLibrarySync(client, scope, async () => {
      if (failCache.current) {
        failCache.current = false;
        setCacheFailures((value) => value + 1);
        throw new Error('Fixture cache reconciliation failure');
      }
    });
    void upsertActivityDTOs(scope, [source]).then(() => setReady(true));
    return unregister;
  }, [client]);
  const activity = dtoToActivity(
    library.snapshot?.activities.find((item) => item.id === source.id) ??
      source,
  );
  return (
    <main data-review-ready={ready} className="mx-auto max-w-4xl p-3">
      <h1 className="text-xl">Activity accessibility review</h1>
      <script type="application/json" data-review-activity>
        {JSON.stringify(source)}
      </script>
      <div className="flex items-center gap-2">
        <CombineSelectionButton />
        <ClearSelectionButton />
        <button
          onClick={() => {
            failCache.current = true;
          }}
        >
          Fail next cache reconciliation
        </button>
        <button
          onClick={() => {
            void upsertActivityDTOs(scope, [
              { ...source, name: 'Background server title' },
            ]);
          }}
        >
          Simulate background update
        </button>
        <button
          onClick={() => {
            const user = store.getState().user;
            if (user)
              store.setState({
                user: {
                  ...user,
                  stravaPermissions: { activities: 'all', edit: false },
                },
              });
          }}
        >
          Deny editing permission
        </button>
        <button
          onClick={() => {
            const user = store.getState().user;
            if (user)
              store.setState({ user: { ...user, stravaPermissions: null } });
          }}
        >
          Restore unknown permissions
        </button>
        <output data-cache-failures className="sr-only">
          {cacheFailures}
        </output>
        <output aria-label="Map commands">{commands}</output>
      </div>
      <section aria-label="Recorded activity">
        <ActivityCardContent
          activity={activity}
          onShowOnMap={() => setCommands((value) => value + 1)}
        />
      </section>
      <section aria-label="Activity without route">
        <ActivityCardContent
          activity={{
            ...activity,
            id: activity.id + 1,
            name: 'Indoor activity',
            map_polyline: null,
            map_summary_polyline: null,
          }}
          readOnly
          onShowOnMap={() => setCommands((value) => value + 1)}
        />
      </section>
      <section aria-label="Sport filter states">
        <SidebarProvider className="min-h-0">
          <CategoryFilter />
        </SidebarProvider>
      </section>
      <Toaster />
    </main>
  );
}

export default function Review() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Surface client={client} />
    </QueryClientProvider>
  );
}
