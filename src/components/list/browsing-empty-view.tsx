import { ListFilter } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { message } from '~/lib/presentation/messages';
import { cn } from '~/lib/utils';

export type BrowsingEmptyKind =
  'library-empty' | 'selection-hidden' | 'filtered-out';

/** Why a browsing surface has no rows. An empty library is never recoverable by
 * clearing filters; hidden selections and filtered-out results are. */
export function browsingEmptyKind({
  libraryCount,
  selectionHidden = false,
}: {
  libraryCount: number;
  selectionHidden?: boolean;
}): BrowsingEmptyKind {
  if (libraryCount === 0) return 'library-empty';
  return selectionHidden ? 'selection-hidden' : 'filtered-out';
}

// The native picker's wording; there is no catalog entry for it yet.
const selectionHiddenTitle = 'Selection hidden';
const selectionHiddenDetail = 'Your selected activities are hidden by filters.';

export function BrowsingEmptyView({
  kind,
  canClear,
  onClear,
  className,
}: {
  kind: BrowsingEmptyKind;
  /** Whether any filter is in force, so clearing can change the outcome. */
  canClear: boolean;
  onClear: () => void;
  className?: string;
}) {
  const title =
    kind === 'library-empty'
      ? message('status.browsing.noActivitiesInYourLibrary')
      : kind === 'selection-hidden'
        ? selectionHiddenTitle
        : message('status.browsing.noActivitiesMatchYourFilters');
  const detail =
    kind === 'selection-hidden'
      ? selectionHiddenDetail
      : kind === 'filtered-out'
        ? message('status.browsing.yourLibraryIsStillSavedClearFiltersOrChange')
        : undefined;
  return (
    <div
      role="status"
      data-browsing-empty={kind}
      className={cn(
        'flex flex-col items-center gap-3 px-6 py-8 text-center',
        className,
      )}
    >
      {kind !== 'library-empty' && (
        <ListFilter
          className="size-8 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      <p className="text-base font-semibold">{title}</p>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      {kind !== 'library-empty' && canClear && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={onClear}
        >
          {message('status.browsing.clearFilters')}
        </Button>
      )}
    </div>
  );
}
