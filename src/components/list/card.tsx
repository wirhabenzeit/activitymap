'use client';

import GeoJsonToGpx from '@dwayneparton/geojson-to-gpx';
import { type Row } from '@tanstack/react-table';
import type { Feature, LineString } from 'geojson';
import {
  Download,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Image as PhotosIcon,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { ActivitySelectionSymbol } from '~/components/activity-selection-controls';
import { DismissButton } from '~/components/dismiss-button';
import { Button } from '~/components/ui/button';
import { Card, CardHeader, CardTitle } from '~/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { useActivityMutations } from '~/hooks/use-activity-mutations';
import {
  useDateFormat,
  useFormattingLocale,
} from '~/hooks/use-display-preferences';
import { useElementSize } from '~/hooks/use-element-size';
import { usePhotos } from '~/hooks/use-photos';
import type {
  ActivityMapCommand,
  MapActionVariant,
} from '~/hooks/use-show-on-map';
import { useToast } from '~/hooks/use-toast';
import { type Activity } from '~/lib/activity';
import { isSilentActivityCommandError } from '~/lib/activity-command-session';
import { activityGPXCoordinates } from '~/lib/activity-gpx';
import { activityMutationAvailability } from '~/lib/activity-mutation-availability';
import {
  mutationFailureNotice,
  mutationNotice,
} from '~/lib/activity-mutation-notice';
import { formatPreferredDate } from '~/lib/date-preferences';
import { formatLocalTime } from '~/lib/local-date-time';
import { semanticAction } from '~/lib/presentation/icons';
import { message } from '~/lib/presentation/messages';
import { activityStreamMetadata } from '~/lib/sync/v1-mappers';
import { cn } from '~/lib/utils';
import { categorySettings } from '~/settings/category';
import { aliasMap } from '~/settings/category';
import { store, useShallowStore } from '~/store';

import { ActivityDetailStats } from './activity-detail-stats';
import { ActivityMapAction } from './activity-map-action';
import { EditActivity } from './edit';
import { ElevationChart } from './elevation-chart';
import { PhotoLightbox } from './photo';
import { RouteDetailsContent } from './route-details-content';
import { type Features } from './table-extensions';

interface ActivityCardContentProps {
  activity: Activity;
  commands?: ReturnType<typeof useActivityMutations>;
  onCollapse?: () => void;
  onClearSelection?: () => void;
  showMapButton?: boolean;
  stickyHeader?: boolean;
  readOnly?: boolean;
  onShowOnMap?: ActivityMapCommand;
  mapActionVariant?: MapActionVariant;
}

/** Cards this wide label "Show on map" and keep Edit beside it (as on iOS). */
const LABELLED_ACTIONS_WIDTH = 520;

export function DescriptionCard({ row }: { row: Row<Features, Activity> }) {
  const activity = row.original;
  const [open, setOpen] = useState(false);
  const canEdit = useShallowStore(
    (state) => activityMutationAvailability(state).canEdit,
  );

  return (
    <>
      <div
        className="flex h-full w-full items-center truncate italic"
        onDoubleClick={() => canEdit && setOpen(true)}
      >
        {activity.description}
      </div>
      <EditActivity
        activity={activity}
        open={open}
        setOpen={setOpen}
        trigger={false}
      />
    </>
  );
}

/** Route details shown in place of a table row (map panel and list). */
export function ActivityCardContent({
  activity,
  commands: suppliedCommands,
  onCollapse,
  onClearSelection,
  showMapButton = true,
  stickyHeader = false,
  readOnly = false,
  onShowOnMap,
  mapActionVariant = 'show',
}: ActivityCardContentProps) {
  const dateFormat = useDateFormat();
  const locale = useFormattingLocale();
  const [open, setOpen] = useState(false);
  const boundCommands = useActivityMutations(activity.id);
  const commands = suppliedCommands ?? boundCommands;
  const loading = commands.isPending;
  const { isGuest, stravaConnected, userId } = useShallowStore((state) => ({
    isGuest: state.isGuest,
    stravaConnected: state.user?.stravaConnected ?? false,
    userId: state.user?.id,
  }));
  const { canEdit, editReason } = useShallowStore(activityMutationAvailability);
  const { data: allPhotos = [] } = usePhotos();
  const { toast } = useToast();
  const [cardRef, { width: cardWidth }] = useElementSize();
  const labelled = cardWidth >= LABELLED_ACTIONS_WIDTH;

  const sport_type = activity.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;
  const activityId = activity.id;

  const photos = allPhotos.filter((p) => p.activity_id === activityId);

  const id: number = activity.id;

  const date = activity.start_date_local;
  const coordinates = useMemo(
    () => activityGPXCoordinates(activity),
    [activity],
  );
  const canExport = coordinates.length > 0;
  const handleRefresh = async () => {
    if (loading || !commands.isCurrent()) return;
    try {
      const outcome = await commands.refresh();
      if (commands.isCurrent())
        toast(
          mutationNotice(
            outcome,
            'refresh',
            () => commands.retryCache(outcome),
            commands.isCurrent,
          ),
        );
    } catch (error) {
      if (isSilentActivityCommandError(error)) return;
      if (commands.isCurrent()) toast(mutationFailureNotice(error, 'refresh'));
    }
  };

  const handleDownloadGpx = () => {
    if (!canExport) return;
    const name: string = activity.name;

    // Create GeoJSON object
    const geojson: Feature<LineString> = {
      type: 'Feature',
      properties: {
        name,
        time: activity.start_date.toISOString(),
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
          name: String(activity.name),
          time: activity.start_date.toISOString(),
          desc: activity.description ?? undefined,
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
        streamMetadata={activityStreamMetadata(activity)}
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
              <ActivitySelectionSymbol
                id={activity.id}
                name={String(activity.name)}
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
                <CardTitle className="text-base leading-5 break-words">
                  {activity.name}
                </CardTitle>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {sport_type} · {formatPreferredDate(date, dateFormat, locale)}{' '}
                  ·{' '}
                  {formatLocalTime(
                    date,
                    {
                      hour: '2-digit',
                      minute: '2-digit',
                    },
                    locale,
                  )}
                </p>
              </div>
            </div>
            <div className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
              {/* The map overlay provides its fit action in the navigation header. */}
              {showMapButton && onShowOnMap && (
                <ActivityMapAction
                  activity={activity}
                  onShowOnMap={onShowOnMap}
                  variant={mapActionVariant}
                  labelled={labelled}
                />
              )}
              {labelled && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 shrink-0 px-2 text-xs"
                  onClick={() => canEdit && setOpen(true)}
                  title={editReason}
                  aria-label={
                    editReason
                      ? message('activity.action.unavailable', {
                          action: message('action.edit'),
                          name: activity.name,
                          reason: editReason,
                        })
                      : undefined
                  }
                  disabled={loading || !canEdit || readOnly}
                >
                  {message('action.edit')}
                </Button>
              )}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={message('actions.more')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!labelled && (
                    <DropdownMenuItem
                      onSelect={() => canEdit && setOpen(true)}
                      title={editReason}
                      aria-label={
                        editReason
                          ? message('activity.action.unavailable', {
                              action: message('action.edit'),
                              name: activity.name,
                              reason: editReason,
                            })
                          : undefined
                      }
                      disabled={loading || !canEdit || readOnly}
                    >
                      <Pencil aria-hidden="true" />
                      <span>
                        {message('action.edit')}
                        {editReason && (
                          <span className="block text-xs text-muted-foreground">
                            {editReason}
                          </span>
                        )}
                      </span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => void handleRefresh()}
                    disabled={
                      loading || isGuest || readOnly || !stravaConnected
                    }
                  >
                    <RefreshCw aria-hidden="true" /> {message('action.refresh')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={handleDownloadGpx}
                    title={
                      !canExport
                        ? message('activity.action.noRoute')
                        : undefined
                    }
                    aria-label={
                      !canExport
                        ? message('activity.action.unavailable', {
                            action: message('action.exportGPX'),
                            name: activity.name,
                            reason: message('activity.action.noRoute'),
                          })
                        : undefined
                    }
                    disabled={!canExport}
                  >
                    <Download aria-hidden="true" />
                    <span>
                      {message('action.exportGPX')}
                      {!canExport && (
                        <span className="block text-xs text-muted-foreground">
                          {message('activity.action.noRoute')}
                        </span>
                      )}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href={`https://strava.com/activities/${id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink aria-hidden="true" />{' '}
                      {message('action.openInStrava')}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {onCollapse && (
                <DismissButton
                  intent="collapse"
                  label={message('action.collapse')}
                  onClick={onCollapse}
                />
              )}
              {onClearSelection && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearSelection}
                  aria-label={message('action.clearSelection')}
                  title={message('action.clearSelection')}
                >
                  {message('action.clearSelection')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <RouteDetailsContent
          key={activityId}
          elevation={elevationProfile}
          description={activity.description}
        >
          <ActivityDetailStats
            activity={activity}
            photos={
              photos.length > 0 ? (
                <section
                  className="min-w-0 border-t pt-3"
                  aria-label={message('activity.photos')}
                >
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <PhotosIcon className="h-4 w-4" aria-hidden="true" />
                    {message('activity.photos')}
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {photos.length}
                    </span>
                  </h3>
                  <PhotoLightbox
                    photos={photos}
                    title={activity.name}
                    className="h-24 sm:h-28"
                  />
                </section>
              ) : undefined
            }
          />
        </RouteDetailsContent>
      </Card>
      <EditActivity
        activity={activity}
        commands={commands}
        open={open}
        setOpen={setOpen}
        trigger={false}
      />
    </>
  );
}

/** Name cell: selection toggle, name, and optional map actions. */
export function ActivityCard({
  row,
  showMapButton = true,
  showHighlightButton = false,
  onShowOnMap,
  mapActionVariant = 'show',
}: {
  row: Row<Features, Activity>;
  showMapButton?: boolean;
  showHighlightButton?: boolean;
  onShowOnMap?: ActivityMapCommand;
  mapActionVariant?: MapActionVariant;
}) {
  const [open, setOpen] = useState(false);
  const { isHighlighted, canEdit } = useShallowStore((state) => ({
    isHighlighted: state.highlighted === row.original.id,
    canEdit: activityMutationAvailability(state).canEdit,
  }));

  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;
  const ActivationIcon = semanticAction('activate').Icon;
  const highlightLabel = message(
    isHighlighted ? 'action.deactivateActivity' : 'action.activateActivity',
    { name: row.original.name },
  );

  const prototypeSelected = useShallowStore((state) =>
    state.selected.includes(row.original.id),
  );
  const nameClassName = cn(
    'text-left truncate justify-start max-w-full hover:underline',
    isHighlighted || prototypeSelected
      ? 'text-header-background'
      : 'text-primary',
    prototypeSelected && 'font-medium',
  );

  return (
    <>
      <div
        className="flex w-full min-w-0 items-center space-x-2"
        onDoubleClick={() => canEdit && setOpen(true)}
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
            title={message(
              isHighlighted ? 'action.deactivateHint' : 'action.activateHint',
            )}
            onClick={() => {
              const state = store.getState();
              state.setHighlighted(
                state.highlighted === row.original.id ? 0 : row.original.id,
              );
            }}
          >
            <ActivationIcon
              aria-hidden="true"
              strokeWidth={isHighlighted ? 2.5 : 2}
            />
          </Button>
        )}
        {showMapButton && onShowOnMap && (
          <ActivityMapAction
            activity={row.original}
            onShowOnMap={onShowOnMap}
            variant={mapActionVariant}
            compact
          />
        )}
      </div>
      <EditActivity
        activity={row.original}
        open={open}
        setOpen={setOpen}
        trigger={false}
      />
    </>
  );
}
