'use client';

import GeoJsonToGpx from '@dwayneparton/geojson-to-gpx';
import { decode } from '@mapbox/polyline';
import { ReloadIcon } from '@radix-ui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { type Row } from '@tanstack/react-table';
import type { Feature, LineString } from 'geojson';
import {
  Download,
  ExternalLink,
  Map,
  Minus,
  MoreHorizontal,
  Pencil,
  Image as PhotosIcon,
  Route,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { ActivitySelectionSymbol } from '~/components/activity-selection-controls';
import { Button } from '~/components/ui/button';
import { Card, CardHeader, CardTitle } from '~/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { useActivities } from '~/hooks/use-activities';
import { useDateFormat } from '~/hooks/use-display-preferences';
import { usePhotos } from '~/hooks/use-photos';
import { useToast } from '~/hooks/use-toast';
import { reloadStreamSummaryActivity } from '~/lib/activity-stream-summary';
import { formatPreferredDate } from '~/lib/date-preferences';
import { formatLocalTime } from '~/lib/local-date-time';
import { showActivityOnMap } from '~/lib/show-on-map';
import { authenticatedLibraryScope } from '~/lib/sync/library-owner';
import { requestLibrarySync } from '~/lib/sync/library-sync';
import { activityStreamMetadata } from '~/lib/sync/v1-mappers';
import { cn } from '~/lib/utils';
import { type Activity } from '~/server/db/schema';
import { refreshActivity } from '~/server/strava/actions';
import { categorySettings } from '~/settings/category';
import { aliasMap } from '~/settings/category';
import { store, useShallowStore } from '~/store';
import { applyFilters } from '~/store/filter';

import { ActivityDetailStats } from './activity-detail-stats';
import { EditActivity } from './edit';
import { ElevationChart } from './elevation-chart';
import { PhotoLightbox } from './photo';
import { RouteDetailsContent } from './route-details-content';
import { type Features } from './table-extensions';

interface ActivityCardContentProps {
  row: Row<Features, Activity>;
  onCollapse?: () => void;
  onClearSelection?: () => void;
  showMapButton?: boolean;
  stickyHeader?: boolean;
  readOnly?: boolean;
}

/**
 * Adds the activity to the selection, keeps whatever else is selected, and
 * frames its route on the map.
 */
function useShowOnMap(row: Row<Features, Activity>) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: activities } = useActivities();
  const hidden = useShallowStore((state) => !applyFilters(state, row.original));
  const label = hidden ? 'Clear filters and show on map' : 'Show on map';
  const show = () => {
    const result = showActivityOnMap(
      store,
      row.original,
      activities ?? [row.original],
      hidden,
    );
    if (result !== 'shown') {
      store.getState().addNotification({
        type: 'info',
        title: 'Map camera',
        message:
          result === 'no-route'
            ? 'This activity has no GPS route to frame.'
            : result === 'unavailable'
              ? 'This activity is no longer available.'
              : 'This activity is hidden by filters. Clear filters and try again.',
      });
      return;
    }
    router.push(
      pathname === '/selection-prototype'
        ? '/selection-prototype?view=map'
        : '/map',
    );
  };
  return { show, label };
}

/** Cards this wide label "Show on map" and keep Edit beside it (as on iOS). */
const LABELLED_ACTIONS_WIDTH = 520;

function useElementWidth() {
  const [width, setWidth] = useState(0);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function DescriptionCard({ row }: { row: Row<Features, Activity> }) {
  const [open, setOpen] = useState(false);
  const isGuest = useShallowStore((state) => state.isGuest);

  return (
    <>
      <div
        className="flex h-full w-full items-center truncate italic"
        onDoubleClick={() => !isGuest && setOpen(true)}
      >
        {row.original.description}
      </div>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}

/** Route details shown in place of a table row (map panel and list). */
export function ActivityCardContent({
  row,
  onCollapse,
  onClearSelection,
  showMapButton = true,
  stickyHeader = false,
  readOnly = false,
}: ActivityCardContentProps) {
  const dateFormat = useDateFormat();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { isGuest, stravaConnected, userId } = useShallowStore((state) => ({
    isGuest: state.isGuest,
    stravaConnected: state.user?.stravaConnected ?? false,
    userId: state.user?.id,
  }));
  const { data: allPhotos = [] } = usePhotos();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { show: showOnMap, label: showOnMapLabel } = useShowOnMap(row);
  const [cardRef, cardWidth] = useElementWidth();
  const labelled = cardWidth >= LABELLED_ACTIONS_WIDTH;
  const hasRoute = !!(
    row.original.map_polyline ?? row.original.map_summary_polyline
  );

  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;
  const activityId = row.original.id;

  const photos = allPhotos.filter((p) => p.activity_id === activityId);

  const id: number = row.getValue('id');

  const date = row.original.start_date_local;
  const handleRefresh = async () => {
    const isCurrent = () => {
      const state = useShallowStore.getState();
      return !!userId && state.user?.id === userId && !state.isGuest;
    };
    if (!isCurrent()) return;
    if (!stravaConnected) return;
    setLoading(true);
    try {
      await refreshActivity(row.original.id);
      if (!userId || !isCurrent()) return;

      if (userId) {
        await reloadStreamSummaryActivity(
          queryClient,
          userId,
          String(row.original.id),
        );
      }

      if (userId)
        await requestLibrarySync(
          queryClient,
          authenticatedLibraryScope(userId),
        );
      if (!isCurrent()) return;

      toast({
        title: 'Activity Refreshed',
        description: 'Successfully refreshed activity data from Strava.',
      });
    } catch (error) {
      if (!isCurrent()) return;
      console.error(error);
      toast({
        title: 'Error',
        description: 'Failed to refresh activity.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadGpx = () => {
    const polyline =
      row.original.map_polyline ?? row.original.map_summary_polyline;
    if (!polyline) return;

    // Decode polyline to coordinates
    const coordinates = decode(polyline).map(([lat, lon]) => [lon, lat]);
    const name: string = row.getValue('name');

    // Create GeoJSON object
    const geojson: Feature<LineString> = {
      type: 'Feature',
      properties: {
        name,
        time: row.original.start_date.toISOString(),
      },
      geometry: {
        type: 'LineString',
        coordinates,
      },
    };

    // Convert to GPX with metadata
    const options: { metadata: { name: string; time: string; desc?: string } } =
      {
        metadata: {
          name: String(row.getValue('name')),
          time: row.original.start_date.toISOString(),
          desc: row.original.description ?? undefined,
        },
      };

    const gpx = GeoJsonToGpx(geojson, options);
    const gpxString = new XMLSerializer().serializeToString(gpx);

    // Create and trigger download
    const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const elevationProfile =
    !isGuest && stravaConnected && userId ? (
      <ElevationChart
        activityId={String(activityId)}
        userId={userId}
        streamMetadata={activityStreamMetadata(row.original)}
      />
    ) : null;

  return (
    <>
      {/* Lay out by the card's own width, not the screen's: a card spanning a
          wide table goes side by side even on a phone. */}
      <Card ref={cardRef} className="@container w-full border-none shadow-none">
        <CardHeader
          className={cn(
            'space-y-1 px-4 pt-3 pb-3',
            stickyHeader && 'sticky top-0 z-10 bg-background',
          )}
        >
          <div className="flex items-center gap-2">
            <ActivitySelectionSymbol
              id={row.original.id}
              name={String(row.getValue('name'))}
              disabled={readOnly}
            >
              {Icon && sport_group && (
                <Icon
                  className="size-5 shrink-0"
                  color={categorySettings[sport_group].color}
                />
              )}
            </ActivitySelectionSymbol>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base leading-5">
                {row.getValue('name')}
              </CardTitle>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {sport_type} · {formatPreferredDate(date, dateFormat)} ·{' '}
                {formatLocalTime(date, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            {/* The map overlay provides its fit action in the navigation header. */}
            {showMapButton && (
              <Button
                variant="secondary"
                size="sm"
                className={cn(
                  'h-8 shrink-0 gap-1.5 bg-header-background/10 text-header-background hover:bg-header-background/15',
                  labelled ? 'px-3' : 'w-8 px-0',
                )}
                onClick={showOnMap}
                disabled={!hasRoute}
                aria-label={
                  showOnMapLabel === 'Show on map'
                    ? `Show ${String(row.getValue('name'))} on map`
                    : `${showOnMapLabel}: ${String(row.getValue('name'))}`
                }
                title={hasRoute ? showOnMapLabel : 'No GPS route recorded'}
              >
                <Map className="h-4 w-4" aria-hidden="true" />
                {labelled && showOnMapLabel}
              </Button>
            )}
            {labelled && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => setOpen(true)}
                disabled={isGuest || readOnly}
              >
                Edit
              </Button>
            )}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="More route actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!labelled && (
                  <DropdownMenuItem
                    onSelect={() => setOpen(true)}
                    disabled={isGuest || readOnly}
                  >
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => void handleRefresh()}
                  disabled={loading || isGuest || readOnly || !stravaConnected}
                >
                  <ReloadIcon /> Refresh from Strava
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={handleDownloadGpx}
                  disabled={
                    !row.original.map_polyline &&
                    !row.original.map_summary_polyline
                  }
                >
                  <Download /> Download GPX
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href={`https://strava.com/activities/${id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink /> Open in Strava
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={onCollapse}
                aria-label="Collapse route details"
                title="Collapse route details"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            {onClearSelection && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearSelection}
                aria-label="Clear selection"
                title="Clear selection"
              >
                Clear selection
              </Button>
            )}
          </div>
        </CardHeader>
        <RouteDetailsContent
          key={activityId}
          elevation={elevationProfile}
          description={row.original.description}
        >
          <ActivityDetailStats
            activity={row.original}
            photos={
              photos.length > 0 ? (
                <section
                  className="min-w-0 border-t pt-3"
                  aria-label="Activity photos"
                >
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <PhotosIcon className="h-4 w-4" aria-hidden="true" />
                    Photos
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {photos.length}
                    </span>
                  </h3>
                  <PhotoLightbox
                    photos={photos}
                    title={row.getValue('name')}
                    className="h-24 sm:h-28"
                  />
                </section>
              ) : undefined
            }
          />
        </RouteDetailsContent>
      </Card>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}

/** Name cell: selection toggle, name, and optional map actions. */
export function ActivityCard({
  row,
  showMapButton = true,
  showHighlightButton = false,
}: {
  row: Row<Features, Activity>;
  showMapButton?: boolean;
  showHighlightButton?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { highlighted, isGuest } = useShallowStore((state) => ({
    highlighted: state.highlighted,
    isGuest: state.isGuest,
  }));
  const { show: handleMapClick, label: showOnMapLabel } = useShowOnMap(row);

  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;
  const isHighlighted = highlighted === row.original.id;
  const highlightLabel = `${isHighlighted ? 'Deactivate' : 'Make active'}: ${row.original.name}`;

  const prototypeSelected = useShallowStore((state) =>
    state.selected.includes(row.original.id),
  );
  const nameClassName = cn(
    'text-left truncate justify-start max-w-full hover:underline',
    highlighted === Number(row.id) || prototypeSelected
      ? 'text-header-background'
      : 'text-primary',
    prototypeSelected && 'font-medium',
  );

  return (
    <>
      <div
        className="flex w-full min-w-0 items-center space-x-2"
        onDoubleClick={() => !isGuest && setOpen(true)}
      >
        <ActivitySelectionSymbol
          id={row.original.id}
          name={String(row.getValue('name'))}
        >
          {Icon && sport_group && (
            <Icon
              className="size-5 shrink-0"
              color={categorySettings[sport_group].color}
            />
          )}
        </ActivitySelectionSymbol>
        <div className={nameClassName}>{row.getValue('name')}</div>
        <div className="flex-1" />
        {showHighlightButton && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-8 shrink-0 text-muted-foreground',
              isHighlighted &&
                'text-header-background hover:text-header-background',
            )}
            aria-label={highlightLabel}
            aria-pressed={isHighlighted}
            title={
              isHighlighted
                ? 'Active on map. Clear highlight'
                : 'Highlight route on map'
            }
            onClick={() => {
              const state = store.getState();
              state.setHighlighted(
                state.highlighted === row.original.id ? 0 : row.original.id,
              );
            }}
          >
            <Route aria-hidden="true" strokeWidth={isHighlighted ? 2.5 : 2} />
          </Button>
        )}
        {showMapButton && (
          <Button
            variant="ghost"
            className="h-4 px-0"
            size="sm"
            onClick={handleMapClick}
            aria-label={
              showOnMapLabel === 'Show on map'
                ? `Show ${String(row.getValue('name'))} on map`
                : `${showOnMapLabel}: ${String(row.getValue('name'))}`
            }
            title={showOnMapLabel}
          >
            <Map className="h-4 w-4" />
          </Button>
        )}
      </div>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}
