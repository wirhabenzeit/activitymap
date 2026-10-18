'use client';

import { useMemo, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { MY_SHARE_LINKS_QUERY_KEY } from '~/components/share/manage-shares-dialog';
import { useToast } from '~/hooks/use-toast';
import { useActivities } from '~/hooks/use-activities';
import { formatPreferredDate } from '~/lib/date-preferences';
import { useDateFormat } from '~/hooks/use-display-preferences';
import { useShallowStore } from '~/store';
import {
  DEFAULT_SHARE_LINK_FIELD_OPTIONS,
  type ShareLinkFieldOptions,
} from '~/lib/sharing/fields';
import { SHARED_ROUTE_END_TRIM_METERS } from '~/lib/sharing/route-trim';
import { createShareLink } from '~/lib/sharing/client';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const EXPIRY_OPTIONS = [
  { label: '1 hour', ms: HOUR_MS },
  { label: '1 day', ms: DAY_MS },
  { label: '3 days', ms: 3 * DAY_MS },
  { label: '7 days', ms: 7 * DAY_MS },
  { label: '14 days', ms: 14 * DAY_MS },
  { label: '30 days', ms: 30 * DAY_MS },
] as const;

type Step = 'configure' | 'created';

function pluralizeTracks(count: number) {
  return `${count} ${count === 1 ? 'track' : 'tracks'}`;
}

/** The configuration screen discloses the exact scope and privacy before Create link. */
export function CreateShareDialog({
  onShowLinks,
}: {
  onShowLinks: () => void;
}) {
  const dateFormat = useDateFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const selected = useShallowStore((state) => state.selected);
  const { data: activities = [] } = useActivities();

  const selectedActivities = useMemo(
    () => activities.filter((activity) => selected.includes(activity.id)),
    [activities, selected],
  );

  const [step, setStep] = useState<Step>('configure');
  const [expiresInMs, setExpiresInMs] = useState<number>(EXPIRY_OPTIONS[3].ms); // 7 days
  const [fields, setFields] = useState<ShareLinkFieldOptions>(
    DEFAULT_SHARE_LINK_FIELD_OPTIONS,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selectionLabel = pluralizeTracks(selectedActivities.length);

  async function handleCreate() {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const result = await createShareLink({
        activityIds: selectedActivities.map((activity) => String(activity.id)),
        expiresInMs,
        fields,
      });
      const url = new URL(
        `/share/${result.token}`,
        window.location.origin,
      ).toString();
      setCreatedUrl(url);
      setStep('created');
      void queryClient.invalidateQueries({
        queryKey: MY_SHARE_LINKS_QUERY_KEY,
      });
    } catch (error) {
      toast({
        title: 'Could not create share link',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopy() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
  }

  if (step === 'created' && createdUrl) {
    return (
      <>
        <DialogHeader className="text-left">
          <DialogTitle>Link created</DialogTitle>
          <DialogDescription>
            Copy it now. For your privacy, the full link is only shown once.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Label htmlFor="created-link" className="sr-only">
            Share link
          </Label>
          <Input
            id="created-link"
            value={createdUrl}
            readOnly
            className="flex-1 font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="secondary"
            className="w-24"
            onClick={handleCopy}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
          <Button variant="outline" onClick={onShowLinks}>
            Your links
          </Button>
          <DialogClose asChild>
            <Button>Done</Button>
          </DialogClose>
        </DialogFooter>
      </>
    );
  }

  if (selectedActivities.length === 0) {
    return (
      <>
        <DialogHeader className="text-left">
          <DialogTitle>Share tracks</DialogTitle>
          <DialogDescription>
            Select one or more activities on the map or list, then come back
            here to create a private link to their tracks.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
          <Button variant="outline" onClick={onShowLinks}>
            Your links
          </Button>
          <DialogClose asChild>
            <Button>OK</Button>
          </DialogClose>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle>Share {selectionLabel}</DialogTitle>
        <DialogDescription>
          Anyone with this link can view these tracks on a map until it expires
          or you revoke it.
        </DialogDescription>
      </DialogHeader>

      <ul
        className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground"
        aria-label="Activities to share"
      >
        {selectedActivities.map((activity) => (
          <li key={activity.id} className="flex justify-between gap-3">
            <span className="truncate">{activity.name}</span>
            <span className="shrink-0 tabular-nums">
              {formatPreferredDate(activity.start_date_local, dateFormat)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Shares route, elevation profile, name, sport, date and time, distance,
        moving time, elevation gain and average speed. Heart rate, power,
        calories, social information, descriptions and photos are excluded.
        Private Strava activities are omitted from the shared map.
      </p>

      <div className="divide-y rounded-md border">
        <div className="flex items-center justify-between gap-4 px-3 py-2">
          <Label htmlFor="share-expiry">Expires after</Label>
          <Select
            disabled={isCreating}
            value={String(expiresInMs)}
            onValueChange={(value) => setExpiresInMs(Number(value))}
          >
            <SelectTrigger id="share-expiry" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((option) => (
                <SelectItem key={option.ms} value={String(option.ms)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label
          htmlFor="share-route-ends"
          className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5"
        >
          <span className="grid gap-1">
            <span className="text-sm font-medium leading-none">
              Show start and finish
            </span>
            <span className="text-xs text-muted-foreground">
              Otherwise the first and last {SHARED_ROUTE_END_TRIM_METERS} m are
              hidden.
            </span>
          </span>
          <Switch
            id="share-route-ends"
            disabled={isCreating}
            checked={fields.showRouteEnds}
            onCheckedChange={(checked) =>
              setFields((current) => ({ ...current, showRouteEnds: checked }))
            }
          />
        </label>
      </div>

      <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
        <Button variant="outline" onClick={onShowLinks} disabled={isCreating}>
          Your links
        </Button>
        <Button onClick={handleCreate} disabled={isCreating}>
          {isCreating ? 'Creating…' : 'Create link'}
        </Button>
      </DialogFooter>
    </>
  );
}
