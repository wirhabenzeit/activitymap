'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTable } from '@tanstack/react-table';
import { Activity, Suspense, createElement, useEffect, useState } from 'react';

import {
  AppDialogBody,
  AppDialogContent,
  AppDialogHeader,
} from '~/components/app-dialog';
import {
  SignedOutConnectPanel,
  StravaConnectProvider,
} from '~/components/auth/strava-connect';
import { ActivityMapAction } from '~/components/list/activity-map-action';
import { columns } from '~/components/list/columns';
import { EditActivity } from '~/components/list/edit';
import { PhotoLightbox } from '~/components/list/photo';
import { features } from '~/components/list/table-extensions';
import { FeatureInfoCard } from '~/components/map/feature-info-card';
import { LayerSwitcher } from '~/components/map/layer-switcher';
import {
  PreferenceMenuCheckboxItem,
  PreferenceMenuContent,
  PreferenceMenuSubContent,
} from '~/components/preference-menu';
import { SettingsDialog } from '~/components/settings/settings-dialog';
import { ShareButton } from '~/components/share-button';
import { Dialog, DialogDescription, DialogTitle } from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { useElementSize } from '~/hooks/use-element-size';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { upsertActivityDTOs } from '~/lib/sync/v1-store';
import type { Photo } from '~/server/db/schema';
import { store } from '~/store';

import fixture from '../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';

const defaults = Object.fromEntries(
  Object.keys(activityDTOSchema.shape)
    .filter((key) => key !== 'streams')
    .map((key) => [key, null]),
);
const activityDTOs = fixture.activities.map((item) =>
  activityDTOSchema.parse({ ...defaults, ...item }),
);
const activities = activityDTOs.map(dtoToActivity);
const first = activities[0]!;
const noRoute = {
  ...first,
  map_polyline: null,
  map_summary_polyline: null,
  name: 'Indoor ride',
};
const photo: Photo = {
  unique_id: 'test-photo',
  activity_id: first.id,
  athlete_id: 42,
  activity_name: first.name,
  caption: 'Fixture photo',
  type: 1,
  source: 1,
  urls: { '600': '/favicon.svg' },
  sizes: { '600': [600, 600] },
  default_photo: true,
  location: null,
  uploaded_at: null,
  created_at: null,
  post_id: null,
  status: null,
  resource_state: null,
};

function Probe({ tag, width }: { tag: 'div' | 'section'; width: number }) {
  const [ref, size] = useElementSize<HTMLElement>({ retainSize: true });
  return createElement(
    tag,
    {
      ref,
      'data-measured': '',
      style: {
        boxSizing: 'border-box',
        width,
        height: 120,
        padding: 10,
        border: '4px solid transparent',
      },
    },
    <output data-size="">
      {size.width}×{size.height}:{String(size.ready)}
    </output>,
  );
}

function Content() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const [edit, setEdit] = useState(false);
  const [connect, setConnect] = useState(false);
  const [nested, setNested] = useState(false);
  const [popupChanges, setPopupChanges] = useState(0);
  const [popupChecked, setPopupChecked] = useState(false);
  const [feature, setFeature] = useState(false);
  const [tag, setTag] = useState<'div' | 'section'>('div');
  const [width, setWidth] = useState(240);
  const [hidden, setHidden] = useState(false);
  const [commands, setCommands] = useState(0);
  const [route, setRoute] = useState(false);
  const table = useTable({
    features,
    columns,
    data: activities,
    getRowId: (row) => String(row.id),
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      await upsertActivityDTOs('auth:reconciliation-review', activityDTOs);
      if (!active) return;
      store.getState().initializeAuth({
        currentUser: {
          id: 'reconciliation-review',
          name: 'Reconciliation fixture',
          email: null,
          image: null,
          athleteId: 42,
          stravaConnected: true,
          stravaPermissions: null,
        },
      });
      store.setState({ selected: activities.map((item) => item.id) });
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);
  if (!ready) return <p>Preparing fixture</p>;
  return (
    <main className="space-y-3 p-4">
      <div className="flex flex-wrap gap-3">
        <button onClick={() => setSettings(true)}>Open Settings</button>
        <button onClick={() => setEdit(true)}>Open Edit</button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button>Dialog actions</button>
          </DropdownMenuTrigger>
          <PreferenceMenuContent>
            <DropdownMenuItem onSelect={() => setEdit(true)}>
              Edit from menu
            </DropdownMenuItem>
          </PreferenceMenuContent>
        </DropdownMenu>
        <ShareButton />
        <LayerSwitcher />
        <button
          onClick={() => {
            store.getState().initializeAuth({ currentUser: null });
            setConnect(true);
          }}
        >
          Open Connect
        </button>
        <button onClick={() => setFeature(true)}>Open Feature</button>
        <PhotoLightbox photos={[photo]} title="Fixture" />
      </div>
      <button onClick={() => setNested(true)}>Open nested popups</button>
      <Dialog open={nested} onOpenChange={setNested}>
        <AppDialogContent closeLabel="Close nested popups" layout="sections">
          <AppDialogHeader>
            <DialogTitle>Nested popups</DialogTitle>
            <DialogDescription>
              Test nested portal interaction.
            </DialogDescription>
          </AppDialogHeader>
          <AppDialogBody>
            <Popover>
              <PopoverTrigger asChild>
                <button>Open dialog popover</button>
              </PopoverTrigger>
              <PopoverContent>
                <button onClick={() => setPopupChanges((value) => value + 1)}>
                  Change from popover
                </button>
              </PopoverContent>
            </Popover>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button>Open dialog menu</button>
              </DropdownMenuTrigger>
              <PreferenceMenuContent>
                <PreferenceMenuCheckboxItem
                  checked={popupChecked}
                  onCheckedChange={(value) => setPopupChecked(value === true)}
                >
                  Dialog preference
                </PreferenceMenuCheckboxItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>More choices</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <PreferenceMenuSubContent>
                      <PreferenceMenuCheckboxItem
                        checked={popupChecked}
                        onCheckedChange={(value) =>
                          setPopupChecked(value === true)
                        }
                      >
                        Nested preference
                      </PreferenceMenuCheckboxItem>
                    </PreferenceMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </PreferenceMenuContent>
            </DropdownMenu>
            <output data-popup-changes="">{popupChanges}</output>
          </AppDialogBody>
        </AppDialogContent>
      </Dialog>
      <SettingsDialog open={settings} onOpenChange={setSettings} />
      <EditActivity
        activity={table.getCoreRowModel().rows[0]!.original}
        open={edit}
        setOpen={setEdit}
        trigger={false}
      />
      {connect && <SignedOutConnectPanel />}
      {feature && (
        <FeatureInfoCard
          feature={{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [8, 46],
                [9, 47],
              ],
            },
            properties: { name: 'Fixture feature' },
          }}
          onClose={() => setFeature(false)}
        />
      )}
      <section
        aria-label="Map action variants"
        className="flex items-center gap-2"
      >
        <button onClick={() => setRoute((value) => !value)}>
          Toggle route
        </button>
        <ActivityMapAction
          activity={route ? first : noRoute}
          onShowOnMap={() => setCommands((value) => value + 1)}
          compact
        />
        <ActivityMapAction
          activity={route ? first : noRoute}
          onShowOnMap={() => setCommands((value) => value + 1)}
          labelled
        />
        <output data-commands="">{commands}</output>
      </section>
      <section aria-label="Measurement lifecycle">
        <button
          onClick={() =>
            setTag((value) => (value === 'div' ? 'section' : 'div'))
          }
        >
          Replace element
        </button>{' '}
        <button
          onClick={() => setWidth((value) => (value === 240 ? 360 : 240))}
        >
          Resize element
        </button>{' '}
        <button onClick={() => setHidden((value) => !value)}>
          Hide measurement
        </button>
        <Activity mode={hidden ? 'hidden' : 'visible'}>
          <Probe tag={tag} width={width} />
        </Activity>
      </section>
    </main>
  );
}

export default function Review() {
  const [client] = useState(() => {
    const value = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    value.setQueryData(['activities', 'auth', null, null, null, ''], {
      pages: [activities],
      pageParams: [0],
    });
    return value;
  });
  return (
    <Suspense>
      <QueryClientProvider client={client}>
        <StravaConnectProvider>
          <Content />
        </StravaConnectProvider>
      </QueryClientProvider>
    </Suspense>
  );
}
