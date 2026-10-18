'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { useToast } from '~/hooks/use-toast';
import { cn } from '~/lib/utils';
import {
  listMyShareLinks,
  revokeShareLink,
} from '~/lib/sharing/client';
import type { ShareLinkSummaryDTO } from '~/contracts/v1/share-links';

export const MY_SHARE_LINKS_QUERY_KEY = ['my-share-links'] as const;

const STATUS_STYLE: Record<ShareLinkSummaryDTO['status'], { label: string; className: string }> = {
  active: {
    label: 'Active',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  expired: { label: 'Expired', className: 'bg-muted text-muted-foreground' },
  revoked: { label: 'Revoked', className: 'bg-muted text-muted-foreground' },
};

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function describeShare(share: ShareLinkSummaryDTO) {
  if (share.status === 'revoked') {
    return share.revokedAt ? `Revoked ${formatTimestamp(share.revokedAt)}` : 'Revoked';
  }
  return `${share.status === 'expired' ? 'Expired' : 'Expires'} ${formatTimestamp(share.expiresAt)}`;
}

/**
 * "My shares" management view (issue #132): every share link the athlete
 * owns, and an immediate revoke control for the active ones. Only the
 * authenticated owner can list or revoke their own shares - enforced
 * server-side by `~/server/application/share-links.ts`, not by this
 * component - so this view never needs (and never receives) another
 * athlete's data.
 */
export function ManageSharesDialog({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const sharesQuery = useQuery({
    queryKey: MY_SHARE_LINKS_QUERY_KEY,
    queryFn: ({ signal }) => listMyShareLinks(signal),
    retry: false,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeShareLink(id),
    onMutate: (id) => setRevokingId(id),
    onSuccess: () => {
      toast({ title: 'Share link revoked', description: 'The link no longer grants access.' });
      void queryClient.invalidateQueries({ queryKey: MY_SHARE_LINKS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Could not revoke share link',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    },
    onSettled: () => setRevokingId(null),
  });

  const shares = sharesQuery.data;
  const emptyMessage = sharesQuery.isError
    ? 'Could not load your share links.'
    : shares === undefined
      ? 'Loading…'
      : shares.length === 0
        ? 'You have not created any share links yet.'
        : null;

  return (
    <>
      <DialogHeader className="text-left">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="-ml-2 h-7 w-7" onClick={onBack}>
            <ArrowLeft />
            <span className="sr-only">Back</span>
          </Button>
          <DialogTitle>Your share links</DialogTitle>
        </div>
        <DialogDescription>Revoking a link takes effect immediately.</DialogDescription>
      </DialogHeader>

      {emptyMessage !== null ? (
        <div className="grid place-items-center gap-3 rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          {emptyMessage}
          {sharesQuery.isError && (
            <Button variant="outline" size="sm" onClick={() => void sharesQuery.refetch()}>
              Try again
            </Button>
          )}
        </div>
      ) : (
        <ul className="max-h-[min(22rem,60vh)] divide-y overflow-y-auto rounded-md border">
          {shares?.map((share) => {
            const status = STATUS_STYLE[share.status];
            return (
              <li key={share.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="grid min-w-0 gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        share.status !== 'active' && 'text-muted-foreground',
                        'text-sm font-medium leading-none',
                      )}
                    >
                      {share.activityCount} {share.activityCount === 1 ? 'track' : 'tracks'}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
                        status.className,
                      )}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {describeShare(share)}
                    {share.fields.showRouteEnds && ' · Start and finish shown'}
                  </p>
                </div>
                {share.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => revokeMutation.mutate(share.id)}
                    disabled={revokingId === share.id}
                  >
                    {revokingId === share.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
