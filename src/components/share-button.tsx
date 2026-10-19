'use client';

import { Share as ShareIcon } from 'lucide-react';
import { useState } from 'react';

import { AppDialogContent } from '~/components/app-dialog';
import { CreateShareDialog } from '~/components/share/create-share-dialog';
import { ManageSharesDialog } from '~/components/share/manage-shares-dialog';
import { Button } from '~/components/ui/button';
import { Dialog, DialogTrigger } from '~/components/ui/dialog';
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
function ShareLinksDialog() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'create' | 'manage'>('create');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setView('create');
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 px-0">
          <ShareIcon className="h-4 w-4" />
          <span className="sr-only">Share</span>
        </Button>
      </DialogTrigger>
      <AppDialogContent closeLabel="Close Share tracks" layout="sections">
        {view === 'create' ? (
          <CreateShareDialog onShowLinks={() => setView('manage')} />
        ) : (
          <ManageSharesDialog onBack={() => setView('create')} />
        )}
      </AppDialogContent>
    </Dialog>
  );
}

export function ShareButton() {
  const isGuest = useShallowStore((state) => state.isGuest);

  // A guest (someone viewing via a shared link) never had a share button of
  // their own.
  if (isGuest) {
    return null;
  }

  return <ShareLinksDialog />;
}
