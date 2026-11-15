'use client';

import { Button } from '~/components/ui/button';
import { message } from '~/lib/presentation/messages';
import { cn } from '~/lib/utils';
import { useShallowStore } from '~/store';
import { type FilterScope, activeFilterCount } from '~/store/filter';

import { BrowsingEmptyView, browsingEmptyKind } from './browsing-empty-view';

/** Stats keep the reporting period and "only selected"; list and map do not. */
export function useClearFilters(scope: FilterScope = 'activities') {
  return useShallowStore((state) =>
    scope === 'stats' ? state.resetActivityFilters : state.resetFilters,
  );
}

/** Inline recovery for compact surfaces such as the selection bar. */
export function ClearFiltersButton({
  scope = 'activities',
  className,
}: {
  scope?: FilterScope;
  className?: string;
}) {
  const clear = useClearFilters(scope);
  return (
    <Button
      type="button"
      variant="link"
      className={cn('h-auto p-0 text-[11px] leading-4', className)}
      onClick={() => clear()}
    >
      {message('status.browsing.clearFilters')}
    </Button>
  );
}

/** The zero-results fallback shared by List and Stats: explains the cause with
 * catalog copy and offers the same recovery as the native apps. */
export function BrowsingEmptyState({
  libraryCount,
  scope = 'activities',
  selectionHidden,
  className,
}: {
  /** Activities in the whole library, before any filter. */
  libraryCount: number;
  scope?: FilterScope;
  /** A selection exists but every selected activity is filtered out. Defaults
   * to "only selected" being on while some activity is selected. */
  selectionHidden?: boolean;
  className?: string;
}) {
  const active = useShallowStore((state) => activeFilterCount(state, scope));
  const onlySelectedHidden = useShallowStore(
    (state) =>
      scope === 'activities' && state.onlySelected && state.selected.length > 0,
  );
  const clear = useClearFilters(scope);
  return (
    <BrowsingEmptyView
      kind={browsingEmptyKind({
        libraryCount,
        selectionHidden: selectionHidden ?? onlySelectedHidden,
      })}
      canClear={active > 0}
      onClear={() => clear()}
      className={className}
    />
  );
}
