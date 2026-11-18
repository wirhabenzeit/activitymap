'use client';

import {
  CircleCheck,
  Download,
  ExternalLink,
  LoaderCircle,
  Merge,
  Pause,
  TriangleAlert,
} from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
} from '~/components/app-dialog';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { type SportType, sportTypes } from '~/contracts/sport';
import type { MergeUploadState } from '~/contracts/v1/activity-merge';
import { ACTIVITY_DESCRIPTION_MAX_LENGTH } from '~/contracts/v1/activity-mutations';
import { useActivities } from '~/hooks/use-activities';
import {
  useDateFormat,
  useDisplayUnits,
} from '~/hooks/use-display-preferences';
import { usePhotos } from '~/hooks/use-photos';
import type { Activity } from '~/lib/activity';
import {
  MergeRequestError,
  STRAVA_UPLOAD_URL,
  downloadMergedFile,
  mergeActivitiesOnStrava,
  stravaActivityUrl,
} from '~/lib/activity-merge/client';
import {
  MERGE_MAX_PARTS,
  MERGE_MIN_PARTS,
  defaultMergedDescription,
  defaultMergedName,
  describeMergeBlocker,
  describeMergeWarning,
  formatGap,
  planMerge,
} from '~/lib/activity-merge/eligibility';
import { activityMutationAvailability } from '~/lib/activity-mutation-availability';
import { formatPreferredDate } from '~/lib/date-preferences';
import { formatLocalTime } from '~/lib/local-date-time';
import { sportTitle } from '~/lib/presentation/sport-title';
import { formatMeasurement } from '~/lib/units';
import { useShallowStore } from '~/store';

type Phase =
  | { kind: 'review' }
  | { kind: 'uploading'; state: MergeUploadState | null }
  | { kind: 'done'; state: MergeUploadState }
  | { kind: 'error'; message: string };

function duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours
    ? `${hours} h ${String(minutes).padStart(2, '0')} min`
    : `${minutes} min`;
}

/** `start_date_local` is wall-clock time stored as UTC (see local-date-time). */
const time = (date: Date) =>
  formatLocalTime(date, { hour: '2-digit', minute: '2-digit' });

/** The biggest image Strava gave for a photo. */
function largestPhotoUrl(urls: Record<string, string> | null): string | null {
  if (!urls) return null;
  const entries = Object.entries(urls).sort(
    ([a], [b]) => Number(b) - Number(a),
  );
  return entries[0]?.[1] ?? null;
}

/**
 * Merge consecutive activities into one new Strava activity. The dialog
 * previews the result from library data, uploads the rebuilt recording and
 * then walks through deleting the originals on Strava, which ActivityMap
 * cannot do itself: Strava's API has no delete.
 */
export function MergeActivitiesDialog({
  parts,
  library,
  onClose,
}: {
  parts: readonly Activity[];
  /** Every activity in the library, live: deletions show up as they sync. */
  library: readonly Activity[];
  onClose: () => void;
}) {
  const [initial] = useState(() => planMerge(parts, library));
  const draft = initial.parts;
  const [name, setName] = useState(() => defaultMergedName(draft));
  const [description, setDescription] = useState(() =>
    defaultMergedDescription(draft),
  );
  const [sport, setSport] = useState<SportType>(initial.sport);
  const [phase, setPhase] = useState<Phase>({ kind: 'review' });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = phase.kind === 'uploading';
  useEffect(() => () => abort.current?.abort(), []);

  const plan = useMemo(() => planMerge(draft, library), [draft, library]);
  const names = useMemo(
    () => new Map(draft.map((part) => [String(part.id), part.name])),
    [draft],
  );
  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <AppDialogContent
        closeLabel="Close merge"
        layout="sections"
        showClose={!busy}
      >
        {phase.kind === 'done' ? (
          <MergeDone
            state={phase.state}
            parts={draft}
            library={library}
            onDownload={() => void download()}
            downloading={downloading}
            downloadError={downloadError}
          />
        ) : (
          <>
            <AppDialogHeader>
              <DialogTitle>Merge {draft.length} activities</DialogTitle>
              <DialogDescription>
                Creates one new activity on Strava from their recordings. Its
                start time shifts by up to 30 seconds to reduce duplicate
                rejections. The originals stay until you delete them on Strava.
              </DialogDescription>
            </AppDialogHeader>
            <AppDialogBody>
              <MergeParts plan={plan} />
              {plan.blockers.length > 0 && (
                <ul role="alert" className="space-y-1 text-sm text-destructive">
                  {plan.blockers.map((blocker, index) => (
                    <li key={index}>{describeMergeBlocker(blocker, nameOf)}</li>
                  ))}
                </ul>
              )}
              {plan.warnings.length > 0 && (
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  {plan.warnings.map((warning, index) => (
                    <li key={index} className="flex gap-2">
                      <TriangleAlert
                        className="mt-0.5 size-3.5 shrink-0 text-amber-600"
                        aria-hidden
                      />
                      <span>{describeMergeWarning(warning, nameOf)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                The new activity is rebuilt from the recorded data (route,
                altitude, heart rate, cadence, power and temperature), with one
                lap per original. Device extras and segment efforts are not
                carried over; Strava matches segments again.
              </p>
              <fieldset disabled={busy} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="merge-name">Name</Label>
                  <Input
                    id="merge-name"
                    value={name}
                    maxLength={255}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="merge-description">Description</Label>
                  <textarea
                    id="merge-description"
                    value={description}
                    maxLength={ACTIVITY_DESCRIPTION_MAX_LENGTH}
                    onChange={(event) => setDescription(event.target.value)}
                    className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="merge-sport">Sport</Label>
                  <Select
                    value={sport}
                    onValueChange={(value) => setSport(value as SportType)}
                  >
                    <SelectTrigger id="merge-sport" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sportTypes.map((value) => (
                        <SelectItem key={value} value={value}>
                          {sportTitle(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </fieldset>
              {phase.kind === 'uploading' && (
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {phase.state
                    ? 'Strava is processing the merged activity…'
                    : 'Building and uploading the merged activity…'}
                </p>
              )}
              {phase.kind === 'error' && (
                <p role="alert" className="text-sm text-destructive">
                  {phase.message}
                </p>
              )}
              {downloadError && (
                <p role="alert" className="text-sm text-destructive">
                  {downloadError}
                </p>
              )}
            </AppDialogBody>
            <AppDialogFooter>
              <Button
                variant="outline"
                disabled={busy || downloading || plan.blockers.length > 0}
                onClick={() => void download()}
              >
                <Download className="size-4" aria-hidden />
                {downloading ? 'Preparing…' : 'Download FIT'}
              </Button>
              <Button
                disabled={
                  busy || plan.blockers.length > 0 || name.trim().length === 0
                }
                onClick={() => void upload()}
              >
                <Merge className="size-4" aria-hidden />
                {busy ? 'Merging…' : 'Merge on Strava'}
              </Button>
            </AppDialogFooter>
          </>
        )}
      </AppDialogContent>
    </Dialog>
  );

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadMergedFile(
        draft.map((part) => String(part.id)),
        sport,
      );
    } catch (error) {
      setDownloadError(
        error instanceof MergeRequestError
          ? error.message
          : 'The merged file could not be prepared.',
      );
    } finally {
      setDownloading(false);
    }
  }

  async function upload() {
    if (!activityMutationAvailability(useShallowStore.getState()).canEdit) {
      setPhase({
        kind: 'error',
        message:
          'Strava did not grant permission to upload. Reconnect Strava in Settings.',
      });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'uploading', state: null });
    const first = draft[0];
    try {
      const state = await mergeActivitiesOnStrava(
        {
          activity_ids: draft.map((part) => String(part.id)),
          name: name.trim(),
          description,
          sport_type: sport,
          ...(first?.gear_id ? { gear_id: first.gear_id } : {}),
          commute: draft.every((part) => part.commute),
          hide_from_home: draft.some((part) => part.hide_from_home),
        },
        (progress) => setPhase({ kind: 'uploading', state: progress }),
        controller.signal,
      );
      setPhase({ kind: 'done', state });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPhase({
        kind: 'error',
        message:
          error instanceof MergeRequestError
            ? error.message
            : 'The merge could not be completed. Check Strava before trying again.',
      });
    }
  }
}

function MergeParts({
  plan,
}: {
  plan: ReturnType<typeof planMerge<Activity>>;
}) {
  const units = useDisplayUnits();
  const dateFormat = useDateFormat();
  const { parts, gaps } = plan;
  if (parts.length === 0) return null;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const distance = parts.reduce((sum, part) => sum + (part.distance ?? 0), 0);
  const moving = parts.reduce((sum, part) => sum + (part.moving_time ?? 0), 0);
  const elevation = parts.reduce(
    (sum, part) => sum + (part.total_elevation_gain ?? 0),
    0,
  );
  const elapsed = Math.round(
    (last.start_date.getTime() +
      (last.elapsed_time ?? 0) * 1000 -
      first.start_date.getTime()) /
      1000,
  );
  return (
    <div className="rounded-md border text-sm">
      <ol aria-label="Activities to merge" className="divide-y">
        {parts.map((part, index) => {
          const gap = index > 0 ? gaps[index - 1] : undefined;
          return (
            <li key={part.id}>
              {gap && (
                <div className="flex items-center gap-2 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
                  <Pause className="size-3" aria-hidden />
                  {formatGap(gap.seconds)} break
                  {gap.meters !== null && gap.meters > 200
                    ? ` · ${formatMeasurement(gap.meters, 'distance', units)} apart`
                    : ''}
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {part.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatPreferredDate(part.start_date_local, dateFormat)}{' '}
                    {time(part.start_date_local)} ·{' '}
                    {sportTitle(part.sport_type)}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums">
                  {formatMeasurement(part.distance, 'distance', units)}
                  <span className="block text-muted-foreground">
                    {duration(part.elapsed_time ?? 0)}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t bg-muted/30 px-3 py-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Distance</dt>
          <dd className="font-medium tabular-nums">
            {formatMeasurement(distance, 'distance', units)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Moving</dt>
          <dd className="font-medium tabular-nums">{duration(moving)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Elapsed</dt>
          <dd className="font-medium tabular-nums">{duration(elapsed)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Elevation</dt>
          <dd className="font-medium tabular-nums">
            {formatMeasurement(elevation, 'elevation', units)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function MergeDone({
  state,
  parts,
  library,
  onDownload,
  downloading,
  downloadError,
}: {
  state: MergeUploadState;
  parts: readonly Activity[];
  library: readonly Activity[];
  onDownload: () => void;
  downloading: boolean;
  downloadError: string | null;
}) {
  const { data: photos = [] } = usePhotos();
  const present = useMemo(
    () => new Set(library.map((activity) => activity.id)),
    [library],
  );
  const partIds = new Set(parts.map((part) => part.id));
  const partPhotos = photos.filter((photo) => partIds.has(photo.activity_id));
  const remaining = parts.filter((part) => present.has(part.id)).length;

  if (state.status !== 'ready')
    return (
      <>
        <AppDialogHeader>
          <DialogTitle>
            {state.status === 'failed'
              ? 'Strava refused the upload'
              : 'Strava is still processing'}
          </DialogTitle>
          <DialogDescription>
            {state.status === 'failed'
              ? (state.error ?? 'Strava could not process the merged file.')
              : 'The upload was accepted but is taking longer than usual. It will appear on Strava when processing finishes.'}
          </DialogDescription>
        </AppDialogHeader>
        <AppDialogBody>
          {state.duplicate_of && (
            <p className="text-sm">
              Strava treats the merged activity as a duplicate of an original.
              Download the merged file, delete the originals on Strava, then
              upload the file on{' '}
              <a
                className="underline"
                href={STRAVA_UPLOAD_URL}
                target="_blank"
                rel="noreferrer"
              >
                Strava’s upload page
              </a>
              .
            </p>
          )}
          {downloadError && (
            <p role="alert" className="text-sm text-destructive">
              {downloadError}
            </p>
          )}
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={onDownload} disabled={downloading}>
            <Download className="size-4" aria-hidden />
            {downloading ? 'Preparing…' : 'Download FIT'}
          </Button>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </AppDialogFooter>
      </>
    );

  return (
    <>
      <AppDialogHeader>
        <DialogTitle>Merged activity created</DialogTitle>
        <DialogDescription>
          {state.metadata_applied
            ? 'It appears in your library once Strava reports it.'
            : 'Strava created it, but the name and sport could not be set. Edit them on Strava.'}
        </DialogDescription>
      </AppDialogHeader>
      <AppDialogBody>
        <Button asChild variant="outline" className="w-full">
          <a
            href={stravaActivityUrl(state.activity_id!)}
            target="_blank"
            rel="noreferrer"
          >
            Check the merged activity on Strava
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </Button>

        <section aria-labelledby="merge-cleanup" className="space-y-2">
          <h3 id="merge-cleanup" className="text-sm font-medium">
            Then delete the originals
          </h3>
          <p className="text-xs text-muted-foreground">
            Strava does not let apps delete activities. Open each original and
            choose Delete from its menu. ActivityMap removes it here once Strava
            reports the deletion.
          </p>
          <ul className="divide-y rounded-md border text-sm">
            {parts.map((part) => {
              const gone = !present.has(part.id);
              return (
                <li
                  key={part.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0 truncate">{part.name}</span>
                  {gone ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                      <CircleCheck className="size-4" aria-hidden />
                      Deleted
                    </span>
                  ) : (
                    <a
                      className="flex shrink-0 items-center gap-1 text-xs underline"
                      href={stravaActivityUrl(part.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open on Strava
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          <p role="status" className="text-xs text-muted-foreground">
            {remaining === 0
              ? 'All originals are deleted.'
              : `${remaining} of ${parts.length} originals still on Strava.`}
          </p>
        </section>

        {partPhotos.length > 0 && (
          <section aria-labelledby="merge-photos" className="space-y-2">
            <h3 id="merge-photos" className="text-sm font-medium">
              Photos to add again
            </h3>
            <p className="text-xs text-muted-foreground">
              Strava’s API cannot upload photos. Save them before deleting the
              originals, then add them to the merged activity in the Strava app.
            </p>
            <ul className="grid grid-cols-4 gap-2">
              {partPhotos.map((photo) => {
                const url = largestPhotoUrl(photo.urls);
                if (!url) return null;
                return (
                  <li key={photo.unique_id}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      title="Open full size to save"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={
                          photo.caption ??
                          `Photo from ${photo.activity_name ?? 'an original'}`
                        }
                        className="aspect-square w-full rounded object-cover"
                        loading="lazy"
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </AppDialogBody>
      <AppDialogFooter>
        <Button variant="outline" onClick={onDownload} disabled={downloading}>
          <Download className="size-4" aria-hidden />
          {downloading ? 'Preparing…' : 'Download FIT'}
        </Button>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </AppDialogFooter>
    </>
  );
}

const MergeContext = createContext<
  ((parts: readonly Activity[]) => void) | null
>(null);

/** Lives in the app shell so selection changes and deletion of the last
 * original cannot unmount an active upload or its cleanup checklist. */
export function MergeActivitiesProvider({ children }: { children: ReactNode }) {
  const { userId, enabled } = useShallowStore((state) => ({
    userId: state.user?.id,
    enabled: !state.isGuest && !!state.user?.features?.activityMerge,
  }));
  const [session, setSession] = useState<{
    userId: string;
    parts: readonly Activity[];
    returnFocus: HTMLElement | null;
  } | null>(null);
  const begin = useCallback(
    (parts: readonly Activity[]) => {
      if (userId && enabled)
        setSession({
          userId,
          parts: [...parts],
          returnFocus:
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
        });
    },
    [userId, enabled],
  );
  const close = () => {
    setSession(null);
    if (session?.returnFocus?.isConnected) session.returnFocus.focus();
  };
  return (
    <MergeContext.Provider value={begin}>
      {children}
      {session && session.userId === userId && enabled && (
        <MergeSession
          key={session.userId}
          parts={session.parts}
          onClose={close}
        />
      )}
    </MergeContext.Provider>
  );
}

function MergeSession({
  parts,
  onClose,
}: {
  parts: readonly Activity[];
  onClose: () => void;
}) {
  const { data: library = parts } = useActivities();
  return (
    <MergeActivitiesDialog parts={parts} library={library} onClose={onClose} />
  );
}

/** The selection bar's Merge action: offered for 2–5 selected activities to
 * athletes the feature is rolled out to, with Strava write permission. */
export function SelectionMergeButton({
  activities,
}: {
  activities: readonly Activity[];
}) {
  const begin = useContext(MergeContext);
  const { enabled, selected, combine, canEdit } = useShallowStore((state) => ({
    enabled: !state.isGuest && !!state.user?.features?.activityMerge,
    selected: state.selected,
    combine: state.combineSelections,
    canEdit: activityMutationAvailability(state).canEdit,
  }));
  if (
    !begin ||
    !enabled ||
    !canEdit ||
    !combine ||
    selected.length < MERGE_MIN_PARTS ||
    selected.length > MERGE_MAX_PARTS
  )
    return null;
  const ids = new Set(selected);
  const parts = activities.filter((activity) => ids.has(activity.id));
  if (parts.length !== selected.length) return null;
  const label = `Merge ${parts.length} selected activities`;
  return (
    <Button
      variant="ghost"
      className="size-11 shrink-0 px-0"
      aria-label={label}
      title={label}
      onClick={() => begin(parts)}
    >
      <Merge className="size-4" aria-hidden />
    </Button>
  );
}
