'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, RefreshCw } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { ScrollArea } from '~/components/ui/scroll-area';
import { useToast } from '~/hooks/use-toast';
import { SHARE_LINK_FIELD_GROUP_LABELS, type ShareLinkFieldOptions } from '~/lib/sharing/fields';
import {
  listMyShareLinks,
  revokeShareLink,
  type ShareLinkSummaryDTO,
} from '~/server/share-actions';

const MY_SHARE_LINKS_QUERY_KEY = ['my-share-links'] as const;

const STATUS_LABEL: Record<ShareLinkSummaryDTO['status'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

function enabledFieldLabels(fields: ShareLinkFieldOptions): string[] {
  return (Object.keys(fields) as (keyof ShareLinkFieldOptions)[])
    .filter((key) => fields[key])
    .map((key) => SHARE_LINK_FIELD_GROUP_LABELS[key].label);
}

/**
 * "My shares" management view (issue #132): every share link the athlete
 * owns, and an immediate revoke control for the active ones. Only the
 * authenticated owner can list or revoke their own shares - enforced
 * server-side by `~/server/application/share-links.ts`, not by this
 * component - so this view never needs (and never receives) another
 * athlete's data.
 */
export function ManageSharesDialog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const sharesQuery = useQuery({
    queryKey: MY_SHARE_LINKS_QUERY_KEY,
    queryFn: () => listMyShareLinks(),
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

  return (
    <>
      <DialogHeader>
        <DialogTitle>My share links</DialogTitle>
        <DialogDescription>
          Every share link you have created. Revoking a link takes effect
          immediately.
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void sharesQuery.refetch()}
          disabled={sharesQuery.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${sharesQuery.isFetching ? 'animate-spin' : ''}`} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>
      <ScrollArea className="h-72 rounded-md border">
        {sharesQuery.isError ? (
          <p className="p-4 text-sm text-muted-foreground">
            Could not load share links. Try refreshing.
          </p>
        ) : shares === undefined ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : shares.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            You have not created any share links yet.
          </p>
        ) : (
          <ul className="divide-y">
            {shares.map((share) => (
              <li key={share.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{STATUS_LABEL[share.status]}</span>
                    <span className="text-xs text-muted-foreground">
                      {share.activityCount} activit{share.activityCount === 1 ? 'y' : 'ies'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(share.createdAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {share.status === 'revoked'
                      ? `Revoked ${share.revokedAt ? new Date(share.revokedAt).toLocaleString() : ''}`
                      : `Expires ${new Date(share.expiresAt).toLocaleString()}`}
                  </p>
                  {enabledFieldLabels(share.fields).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Extra fields: {enabledFieldLabels(share.fields).join(', ')}
                    </p>
                  )}
                </div>
                {share.status === 'active' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeMutation.mutate(share.id)}
                    disabled={revokingId === share.id}
                  >
                    <Ban className="mr-1 h-3.5 w-3.5" />
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </>
  );
}
