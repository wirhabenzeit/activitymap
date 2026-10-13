'use client';

import type { ReactNode } from 'react';
import { Check, Funnel, ListChecks, X } from 'lucide-react';
import { Button } from '~/components/ui/button';
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
            <Funnel className="size-3 text-header-background" aria-hidden />
          </span>
        )}
      </div>
      {(combine ||
        onlySelected ||
        hidden > 0 ||
        filteredCount !== undefined) && (
        <div className="truncate text-[11px] leading-4 text-muted-foreground">
          {combine ? (
            <span className="text-header-background">Combine on</span>
          ) : onlySelected ? (
            'Selected only'
          ) : hidden > 0 ? (
            `${hidden} hidden by filters`
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
      className={`size-10 ${combine ? 'bg-header-background/10 text-header-background hover:bg-header-background/15' : ''}`}
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

export function SelectionActions({ controls }: { controls?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center">
      {controls}
      <ClearSelectionButton />
    </div>
  );
}

export function SelectionBar({
  filterIDs,
  controls,
}: {
  filterIDs: number[];
  controls?: ReactNode;
}) {
  const hasSelection = useShallowStore((state) => state.selected.length > 0);
  if (!hasSelection) return null;
  return (
    <div
      data-selection-bar
      className="flex min-h-12 shrink-0 items-center justify-between gap-1 border-b bg-background px-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <CombineSelectionButton />
        <SelectionCount filterIDs={filterIDs} />
      </div>
      <SelectionActions controls={controls} />
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
          className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-header-background text-white ring-1 ring-background"
        >
          <Check className="size-2.5" />
        </span>
      )}
    </Button>
  );
}
