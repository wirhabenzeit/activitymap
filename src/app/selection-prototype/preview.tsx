'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { AppSidebar } from '~/components/layout/app-sidebar';
import { ActivityListView } from '~/components/list/activity-list';
import InteractiveMap from '~/components/map/interactive-map';
import { Button } from '~/components/ui/button';
import { SidebarProvider, SidebarTrigger } from '~/components/ui/sidebar';
import {
  BrowsingProvider,
  useBrowsingLibrary,
} from '~/hooks/use-browsing-library';
import { prepareGallery } from '~/lib/gallery-fixture';
import { activityFields } from '~/settings/activity';
import { store } from '~/store';

import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';

const initialIDs = [
  20279947341, 20270725942, 20265394210, 20244330171, 20211944523,
];

function reset() {
  store.getState().resetFilters();
  store.getState().setSelected(initialIDs);
  store.getState().setHighlighted(0);
  store.getState().fullList.setColumnVisibility({
    ...Object.fromEntries(
      Object.keys(activityFields).map((key) => [key, false]),
    ),
    id: false,
    name: true,
    distance: true,
    total_elevation_gain: true,
    description: false,
    geometry_state: false,
    time: false,
    photos: false,
    edit: false,
  });
  store.getState().setCombineSelections(false);
  store.getState().setOnlySelected(false);
  store.getState().requestRouteFit(initialIDs);
}

function PreviewContent() {
  const router = useRouter();
  const view = useSearchParams().get('view') === 'list' ? 'list' : 'map';
  const {
    query: { data: activities },
    filterIDs,
  } = useBrowsingLibrary();
  return (
    <SidebarProvider defaultOpen={false} className="flex h-dvh flex-col">
      <header className="z-[60] shrink-0 bg-header-background px-2 text-header-foreground">
        <div className="flex h-14 items-center gap-2">
          <SidebarTrigger className="size-10" />
          {/* Same application mark and navigation proportions as AppHeader. */}
          <Image
            width={27}
            height={24}
            src="/app-mark.svg"
            alt="ActivityMap"
            className="mr-2 h-6 w-auto"
          />
          <nav className="flex items-center gap-4 text-sm font-semibold">
            {(['map', 'list'] as const).map((destination) => (
              <button
                key={destination}
                className={`min-h-11 ${view === destination ? '' : 'opacity-60'}`}
                aria-current={view === destination ? 'page' : undefined}
                onClick={() =>
                  router.push(`/selection-prototype?view=${destination}`)
                }
              >
                {destination === 'map' ? 'Map' : 'List'}
              </button>
            ))}
          </nav>
          <span className="ml-auto text-xs opacity-70">Prototype</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 hover:bg-white/10 hover:text-white"
            aria-label="Reset prototype"
            title="Reset prototype"
            onClick={reset}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {view === 'map' ? (
            <InteractiveMap />
          ) : (
            <ActivityListView activities={activities} filterIDs={filterIDs} />
          )}
        </main>
      </div>
    </SidebarProvider>
  );
}

export default function SelectionPreview() {
  const [client] = useState(() => new QueryClient());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    window.__ACTIVITYMAP_GALLERY__ = {
      activities: fixture.activities,
      selectedIDs: initialIDs,
    };
    prepareGallery(client);
    store.setState({
      baseMap: 'mapboxStreet',
      overlayMaps: [],
      threeDim: false,
      showPhotos: false,
    });
    reset();
    // Publish readiness after fixture installation, not during render.
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => {
      window.clearTimeout(timer);
      store.getState().setCombineSelections(false);
      store.getState().setOnlySelected(false);
      delete window.__ACTIVITYMAP_GALLERY__;
      delete window.__ACTIVITYMAP_GALLERY_MAP__;
    };
  }, [client]);
  return (
    <Suspense>
      <QueryClientProvider client={client}>
        {ready ? (
          <BrowsingProvider>
            <PreviewContent />
          </BrowsingProvider>
        ) : (
          <p className="p-6">Loading selection prototype…</p>
        )}
      </QueryClientProvider>
    </Suspense>
  );
}
