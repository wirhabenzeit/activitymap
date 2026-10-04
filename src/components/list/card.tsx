'use client';

import {
  Map,
  Scan,
  Minus,
  Download,
  MoreHorizontal,
  ExternalLink,
  X,
} from 'lucide-react';
import { decode } from '@mapbox/polyline';
import GeoJsonToGpx from '@dwayneparton/geojson-to-gpx';
import type { Feature, LineString } from 'geojson';

import { type Activity } from '~/server/db/schema';
import { categorySettings } from '~/settings/category';
import { Button } from '~/components/ui/button';
import { aliasMap } from '~/settings/category';
import Link from 'next/link';
import { ReloadIcon } from '@radix-ui/react-icons';

import { type Row } from '@tanstack/react-table';
import { type Features } from './table-extensions';

import { Card, CardHeader, CardTitle } from '~/components/ui/card';
import { ActivityDetailStats } from './activity-detail-stats';

import { EditActivity } from './edit';
import { useState } from 'react';
import { cn } from '~/lib/utils';
import { formatLocalDate, formatLocalTime } from '~/lib/local-date-time';
import { useShallowStore } from '~/store';
import { PhotoLightbox } from './photo';
import { ElevationChart } from './elevation-chart';
import { RouteDetailsContent } from './route-details-content';
import { useRouter } from 'next/navigation';
import { routeBounds, routeCoordinates } from '~/lib/route-framing';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

interface ActivityCardContentProps {
  row: Row<Features, Activity>;
  onCollapse?: () => void;
  onClearSelection?: () => void;
  onFit?: () => void;
}

export function DescriptionCard({ row }: { row: Row<Features, Activity> }) {
  const [open, setOpen] = useState(false);
  const isGuest = useShallowStore((state) => state.isGuest);

  return (
    <>
      <div
        className="w-full truncate italic h-full flex items-center"
        onDoubleClick={() => !isGuest && setOpen(true)}
      >
        {row.original.description}
      </div>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}

import { usePhotos } from '~/hooks/use-photos';
import { useQueryClient } from '@tanstack/react-query';
import { refreshActivity } from '~/server/strava/actions';
import { useToast } from '~/hooks/use-toast';
import { activityStreamMetadata } from '~/lib/sync/v1-mappers';
import { reloadStreamSummaryActivity } from '~/lib/activity-stream-summary';

/** Route details shown in place of a table row (map panel and list). */
export function ActivityCardContent({
  row,
  onCollapse,
  onClearSelection,
  onFit,
}: ActivityCardContentProps) {
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

  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;
  const activityId = row.original.id;

  const photos = allPhotos.filter((p) => p.activity_id === activityId);

  const id: number = row.getValue('id');

  const date = row.original.start_date_local;
  const handleRefresh = async () => {
    if (!stravaConnected) return;
    setLoading(true);
    try {
      await refreshActivity(row.original.id);

      if (userId) {
        await reloadStreamSummaryActivity(
          queryClient,
          userId,
          String(row.original.id),
        );
      }

      await queryClient.invalidateQueries({ queryKey: ['activities'] });
      await queryClient.invalidateQueries({ queryKey: ['photos'] });

      toast({
        title: 'Activity Refreshed',
        description: 'Successfully refreshed activity data from Strava.',
      });
    } catch (error) {
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
      <Card className="@container w-full border-none shadow-none">
        <CardHeader className="space-y-1 px-4 pb-3 pt-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 shrink-0 border p-0"
              onClick={() => row.toggleSelected()}
              aria-label={
                row.getIsSelected() ? 'Deselect route' : 'Select route'
              }
              title={row.getIsSelected() ? 'Deselect route' : 'Select route'}
            >
              {Icon && sport_group && (
                <Icon
                  color={categorySettings[sport_group].color}
                  className="h-5 w-5"
                />
              )}
            </Button>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base leading-5">
                {row.getValue('name')}
              </CardTitle>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {sport_type} ·{' '}
                {formatLocalDate(date, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}{' '}
                ·{' '}
                {formatLocalTime(date, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => setOpen(true)}
              disabled={isGuest}
            >
              Edit
            </Button>
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
                <DropdownMenuItem
                  onSelect={() => void handleRefresh()}
                  disabled={loading || isGuest || !stravaConnected}
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
            {onFit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={onFit}
                aria-label="Fit route"
                title="Fit route"
              >
                <Scan className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            {onClearSelection && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onClearSelection}
                aria-label="Clear selection"
                title="Clear selection"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <RouteDetailsContent
          key={activityId}
          elevation={elevationProfile}
          description={row.original.description}
        >
          <ActivityDetailStats activity={row.original}>
            {photos.length > 0 && (
              <PhotoLightbox
                photos={photos}
                title={row.getValue('name')}
                className="h-16"
              />
            )}
          </ActivityDetailStats>
        </RouteDetailsContent>
      </Card>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}

/**
 * DataTable props that open a route's card in place of its row. The map panel
 * passes its active route; the list passes its own open row.
 */
export function inlineRouteDetails(
  activeId: number,
  setActiveId: (id: number) => void,
) {
  return {
    activeId,
    onRowClick: (row: Row<Features, Activity>) => setActiveId(row.original.id),
    renderInlineDetails: (row: Row<Features, Activity>) => (
      <ActivityCardContent row={row} onCollapse={() => setActiveId(0)} />
    ),
  };
}

/** Name cell: selection toggle, name, and optionally a jump to the map. */
export function ActivityCard({
  row,
  showMapButton = true,
}: {
  row: Row<Features, Activity>;
  showMapButton?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const {
    highlighted,
    setHighlighted,
    isGuest,
    requestRouteFit,
    setSelected,
    addNotification,
  } = useShallowStore((state) => ({
    highlighted: state.highlighted,
    setHighlighted: state.setHighlighted,
    isGuest: state.isGuest,
    requestRouteFit: state.requestRouteFit,
    setSelected: state.setSelected,
    addNotification: state.addNotification,
  }));

  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;

  const handleMapClick = () => {
    if (!routeBounds(routeCoordinates(row.original))) {
      addNotification({
        type: 'info',
        title: 'Map camera',
        message: 'This activity has no GPS route to frame.',
      });
      return;
    }
    setSelected((selected) =>
      selected.includes(row.original.id)
        ? selected
        : [...selected, row.original.id],
    );
    setHighlighted(row.original.id);
    requestRouteFit([row.original.id]);
    router.push('/map');
  };

  const nameClassName = cn(
    'text-left truncate justify-start max-w-full hover:underline',
    highlighted === Number(row.id) ? 'text-header-background' : 'text-primary',
  );

  return (
    <>
      <div
        className="flex items-center space-x-2 w-full"
        onDoubleClick={() => !isGuest && setOpen(true)}
      >
        <Button
          variant={row.getIsSelected() ? 'outline' : 'ghost'}
          size="sm"
          className="h-6 w-6 border"
          onClick={() => row.toggleSelected()}
          aria-label="Select row"
        >
          {Icon && sport_group && (
            <Icon
              color={categorySettings[sport_group].color}
              className="w-6 h-6"
              height="3em"
            />
          )}
        </Button>
        <div className={nameClassName}>{row.getValue('name')}</div>
        <div className="flex-1" />
        {showMapButton && (
          <Button
            variant="ghost"
            className="px-0 h-4"
            size="sm"
            onClick={handleMapClick}
            aria-label={`Show ${String(row.getValue('name'))} on map`}
          >
            <Map className="h-4 w-4" />
          </Button>
        )}
      </div>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}
