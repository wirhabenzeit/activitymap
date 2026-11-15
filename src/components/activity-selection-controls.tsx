'use client';

import {
  Check,
  Download,
  ListChecks,
  Loader2,
  SquareCheckBig,
  X,
} from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';

import { ClearFiltersButton } from '~/components/list/browsing-empty-state';
import { SelectionShareButton } from '~/components/share-button';
import { Button } from '~/components/ui/button';
import { useToast } from '~/hooks/use-toast';
import type { Activity } from '~/lib/activity';
import {
  buildActivitiesGPXArchive,
  downloadBlob,
} from '~/lib/export-activities-gpx';
import { message } from '~/lib/presentation/messages';
import { hasStoredLibraryAccess } from '~/lib/stored-library-access';
import { store, useShallowStore } from '~/store';

export function SelectionCount({
  filterIDs,
  filteredCount,
  hiddenCount,
}: {
  filterIDs?: number[];
  filteredCount?: number;
  hiddenCount?: number;
}) {
  const selected = useShallowStore((state) => state.selected);
  const combine = useShallowStore((state) => state.combineSelections);
  const onlySelected = useShallowStore((state) => state.onlySelected);
  const hidden = filterIDs
    ? selected.filter((id) => !filterIDs.includes(id)).length
    : (hiddenCount ?? 0);
  return (
    <div className="min-w-0 text-sm" aria-live="polite">
      <div className="flex items-center gap-1 font-medium">
        <span className="truncate">
          {hidden > 0
            ? `${selected.length - hidden} of ${selected.length} selected`
            : `${selected.length} selected`}
        </span>
        {onlySelected && (
          <span
            title="Showing selected activities only"
            aria-label="Showing selected activities only"
          >
            <SquareCheckBig
              className="size-3 text-header-background"
              aria-hidden
            />
          </span>
        )}
      </div>
      {(combine ||
        onlySelected ||
        hidden > 0 ||
        filteredCount !== undefined) && (
        <div className="flex items-center gap-2 truncate text-[11px] leading-4 text-muted-foreground">
          {combine ? (
            <span className="text-header-background">Combine on</span>
          ) : onlySelected ? (
            'Selected only'
          ) : hidden > 0 ? (
            <>
              <span className="truncate">
                {message('list.hidden', { count: hidden })}
              </span>
              <ClearFiltersButton className="shrink-0" />
            </>
          ) : (
            `${filteredCount} activities`
          )}
        </div>
      )}
    </div>
  );
}

export function CombineSelectionButton() {
  const combine = useShallowStore((state) => state.combineSelections);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`size-8 shrink-0 ${combine ? 'bg-header-background/10 text-header-background hover:bg-header-background/15' : ''}`}
      aria-label="Combine selections"
      aria-pressed={combine}
      title={
        combine
          ? 'Combine selections: on. Tap to turn off.'
          : 'Combine selections: off. Tap to add activities.'
      }
      onClick={() => store.getState().setCombineSelections(!combine)}
    >
      <ListChecks className="size-5" />
    </Button>
  );
}

export function ClearSelectionButton() {
  const selected = useShallowStore((state) => state.selected);
  return selected.length > 0 ? (
    <Button
      variant="ghost"
      size="icon"
      className="size-10"
      aria-label="Clear selection"
      title="Clear selection"
      onClick={() => store.getState().clearSelection()}
    >
      <X className="size-4" />
    </Button>
  ) : null;
}

/** Downloads the selected routes as a zip of GPX files, with elevation. */
export function SelectionDownloadButton({
  activities,
}: {
  activities: readonly Activity[];
}) {
  const { toast } = useToast();
  const { isGuest, userId, enabled, stored, selected, combine } =
    useShallowStore((state) => ({
      isGuest: state.isGuest,
      userId: state.user?.id,
      enabled: state.user?.features?.activityGPXExport === true,
      stored: hasStoredLibraryAccess(state.user),
      selected: state.selected,
      combine: state.combineSelections,
    }));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  if (
    isGuest ||
    !enabled ||
    !stored ||
    !userId ||
    !combine ||
    selected.length === 0
  )
    return null;
  const selectedIDs = new Set(selected);
  const scope = activities.filter((activity) => selectedIDs.has(activity.id));
  if (scope.length === 0) return null;
  const label = `Download ${scope.length} selected ${scope.length === 1 ? 'activity' : 'activities'} as GPX (zip)`;

  const download = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const archive = await buildActivitiesGPXArchive(
        scope,
        userId,
        new AbortController().signal,
      );
      if (archive.exported === 0) {
        toast({
          variant: 'destructive',
          title: 'Nothing to download',
          description: 'None of the selected activities has a route.',
        });
        return;
      }
      downloadBlob(archive.blob, archive.fileName);
      const missing = archive.exported - archive.withElevation;
      const notes = [
        missing > 0 &&
          `${missing} without elevation (streams not imported yet)`,
        archive.skipped > 0 && `${archive.skipped} without a route skipped`,
      ].filter(Boolean);
      toast({
        title: `Downloaded ${archive.exported} GPX ${archive.exported === 1 ? 'file' : 'files'}`,
        description: notes.length ? notes.join('; ') : undefined,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Download failed',
        description: 'The GPX files could not be created. Try again.',
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 shrink-0"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => void download()}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}

export function SelectionActions({
  controls,
  showShare = true,
  activities,
}: {
  controls?: ReactNode;
  showShare?: boolean;
  activities: readonly Activity[];
}) {
  return (
    <div className="flex shrink-0 items-center">
      {controls}
      {showShare && <SelectionDownloadButton activities={activities} />}
      {showShare && <SelectionShareButton activities={activities} />}
      <ClearSelectionButton />
    </div>
  );
}

export function SelectionBar({
  filterIDs,
  controls,
  backButton,
  showShare = true,
  activities,
}: {
  filterIDs: number[];
  activities: readonly Activity[];
  controls?: ReactNode;
  backButton?: ReactNode;
  showShare?: boolean;
}) {
  const hasSelection = useShallowStore((state) => state.selected.length > 0);
  if (!hasSelection) return null;
  return (
    <div
      data-selection-bar
      className="flex min-h-12 shrink-0 items-center justify-between gap-1 border-b bg-background px-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {backButton ?? <CombineSelectionButton />}
        <SelectionCount filterIDs={filterIDs} />
        {backButton && <CombineSelectionButton />}
      </div>
      <SelectionActions
        controls={controls}
        showShare={showShare}
        activities={activities}
      />
    </div>
  );
}

// The sport icon keeps the same footprint in both modes. Only Combine makes
// it an editable selection control and overlays the selected checkmark.
export function ActivitySelectionSymbol({
  id,
  name,
  disabled = false,
  children,
}: {
  id: number;
  name: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const selected = useShallowStore((state) => state.selected.includes(id));
  const combine = useShallowStore((state) => state.combineSelections);
  if (!combine)
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {children}
      </span>
    );
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`relative size-6 shrink-0 rounded-md border before:absolute before:-inset-1 ${selected ? 'border-header-background/30 bg-header-background/5' : 'border-border'}`}
      disabled={disabled}
      aria-label={`${selected ? 'Deselect' : 'Select'} ${name}`}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        store.getState().toggleSelectedActivity(id);
      }}
    >
      {children}
      {selected && (
        <span
          data-selection-checkmark
          className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-header-background text-white ring-1 ring-background"
        >
          <Check className="size-2.5" />
        </span>
      )}
    </Button>
  );
}
