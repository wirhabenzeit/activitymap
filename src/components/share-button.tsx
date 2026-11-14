'use client';

import { Share as ShareIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { AppDialogContent } from '~/components/app-dialog';
import { CreateShareDialog } from '~/components/share/create-share-dialog';
import { ManageSharesDialog } from '~/components/share/manage-shares-dialog';
import { Button } from '~/components/ui/button';
import { Dialog, DialogTrigger } from '~/components/ui/dialog';
import { useActivities } from '~/hooks/use-activities';
import type { Activity } from '~/lib/activity';
import { useShallowStore } from '~/store';

/**
 * The real replacement for the retired legacy sharing flow (issue #132; see
 * `~/lib/legacy-sharing.ts` and docs/strava-data-policy.md §5): athlete-
 * created, scoped, expiring, revocable private links for an explicit
 * activity subset. There is no "share entire profile" mode any more - the
 * old `/map?user=...`/`/map?activities=...` identifiers are retired
 * entirely; the client projection contains no legacy capability token.
 *
 * The dialog has two views: creating a new link (`CreateShareDialog`,
 * which itself has its own configure/create -> created-link-shown-once
 * steps) and managing/revoking existing ones (`ManageSharesDialog`).
 * Reopening the dialog always lands back on "create" with fresh state - a
 * just-created token is never re-shown, only the links view's metadata
 * about it.
 */
function ShareLinksDialog({
  activities,
  children,
  label,
}: {
  activities: readonly Activity[];
  children?: ReactElement;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<readonly Activity[]>([]);
  const [view, setView] = useState<'create' | 'manage'>('create');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft([...activities]);
          setView('create');
        }
      }}
    >
      <DialogTrigger asChild>
        {children ?? (
          <Button
            variant="ghost"
            className="size-11 shrink-0 px-0"
            aria-label={label}
            title={label}
          >
            <ShareIcon className="size-4" aria-hidden="true" />
          </Button>
        )}
      </DialogTrigger>
      <AppDialogContent closeLabel="Close Share tracks" layout="sections">
        {view === 'create' ? (
          <CreateShareDialog
            activities={draft}
            onShowLinks={() => setView('manage')}
          />
        ) : (
          <ManageSharesDialog onBack={() => setView('create')} />
        )}
      </AppDialogContent>
    </Dialog>
  );
}

/** Explicit activity scope for the detail action. */
export function ActivityShareButton({
  activities,
  children,
}: {
  activities: readonly Activity[];
  children?: ReactElement;
}) {
  const isGuest = useShallowStore((state) => state.isGuest);
  if (isGuest) return null;
  return (
    <ShareLinksDialog activities={activities} label="Share activity">
      {children}
    </ShareLinksDialog>
  );
}

/** Group sharing belongs beside the explicit selection controls. */
export function SelectionShareButton() {
  const { isGuest, selected, combine } = useShallowStore((state) => ({
    isGuest: state.isGuest,
    selected: state.selected,
    combine: state.combineSelections,
  }));
  const { data: activities = [] } = useActivities();
  if (isGuest || !combine || selected.length === 0) return null;
  const selectedIDs = new Set(selected);
  const scope = activities.filter((activity) => selectedIDs.has(activity.id));
  if (scope.length === 0) return null;
  return (
    <ShareLinksDialog
      activities={scope}
      label={`Share ${scope.length} selected ${scope.length === 1 ? 'activity' : 'activities'}`}
    />
  );
}
