'use client';

import { useMemo, useState } from 'react';

import { AlertTriangle, Check, Copy } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
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
import { ScrollArea } from '~/components/ui/scroll-area';
import { useToast } from '~/hooks/use-toast';
import { useActivities } from '~/hooks/use-activities';
import { useShallowStore } from '~/store';
import {
  DEFAULT_SHARE_LINK_FIELD_OPTIONS,
  SHARE_LINK_FIELD_GROUP_LABELS,
  type ShareLinkFieldOptions,
} from '~/lib/sharing/fields';
import { createShareLink } from '~/server/share-actions';

const EXPIRY_OPTIONS = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '14 days', ms: 14 * 24 * 60 * 60 * 1000 },
  { label: '30 days (maximum)', ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

type Step = 'configure' | 'confirm' | 'created';

/**
 * Create-share flow (issue #132): configure -> confirm -> created-link
 * display. The "confirm" step is a deliberate, separate screen - not folded
 * into the same click as "configure" - that restates exactly which
 * activities, which fields, and which expiry were chosen, plus the warning
 * that anyone with the link can view the selection until it expires or is
 * revoked. Only that screen's own button actually creates the link.
 */
export function CreateShareDialog({ onCreated }: { onCreated?: () => void }) {
  const { toast } = useToast();
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

  const hasSelection = selectedActivities.length > 0;

  async function handleConfirmCreate() {
    setIsCreating(true);
    try {
      const result = await createShareLink({
        activityIds: selectedActivities.map((activity) => activity.id),
        expiresInMs,
        fields,
      });
      const url = new URL(`/share/${result.token}`, window.location.origin).toString();
      setCreatedUrl(url);
      setStep('created');
      onCreated?.();
    } catch (error) {
      toast({
        title: 'Could not create share link',
        description: error instanceof Error ? error.message : 'Please try again.',
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
    toast({ title: 'Copied!', description: 'Share link copied to clipboard.' });
  }

  if (step === 'created' && createdUrl) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Your share link is ready</DialogTitle>
          <DialogDescription>
            This is the only time the full link is shown. Save it now - you
            will not be able to view it again, only revoke it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center space-x-2">
            <Input id="created-link" value={createdUrl} readOnly className="flex-1" />
            <Button type="button" size="sm" className="px-3" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="sr-only">Copy</span>
            </Button>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Anyone with this link can view the selected activities until it
              expires or you revoke it. It will not be shown again - copy it
              now.
            </p>
          </div>
        </div>
      </>
    );
  }

  if (step === 'confirm') {
    const enabledGroups = (Object.keys(fields) as (keyof ShareLinkFieldOptions)[]).filter(
      (key) => fields[key],
    );
    return (
      <>
        <DialogHeader>
          <DialogTitle>Confirm before sharing</DialogTitle>
          <DialogDescription>
            Review exactly what this link will disclose. Creating it is a
            separate, explicit action from selecting activities in the app.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <div>
            <p className="font-medium">
              {selectedActivities.length} activit
              {selectedActivities.length === 1 ? 'y' : 'ies'} will be shared
            </p>
            <ScrollArea className="mt-1 h-32 rounded-md border p-2">
              <ul className="space-y-1">
                {selectedActivities.map((activity) => (
                  <li key={activity.id} className="truncate text-muted-foreground">
                    {activity.name} -{' '}
                    {new Date(activity.start_date_local).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
          <div>
            <p className="font-medium">Fields disclosed</p>
            <p className="text-muted-foreground">
              Name, date, distance, time, elevation, speed, and route
              {enabledGroups.length > 0 ? ', plus:' : '.'}
            </p>
            {enabledGroups.length > 0 && (
              <ul className="list-inside list-disc text-muted-foreground">
                {enabledGroups.map((key) => (
                  <li key={key}>{SHARE_LINK_FIELD_GROUP_LABELS[key].label}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="font-medium">Expires</p>
            <p className="text-muted-foreground">
              {EXPIRY_OPTIONS.find((option) => option.ms === expiresInMs)?.label ??
                `${Math.round(expiresInMs / (60 * 60 * 1000))} hours`}{' '}
              from now, or immediately if you revoke it sooner.
            </p>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Anyone who receives this link can view the activities and
              fields listed above until it expires or you revoke it. Only
              share it with people you intend to give access to.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => setStep('configure')} disabled={isCreating}>
            Back
          </Button>
          <Button onClick={handleConfirmCreate} disabled={isCreating}>
            {isCreating ? 'Creating…' : 'I understand, create the link'}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create a share link</DialogTitle>
        <DialogDescription>
          Share a private, expiring link to exactly the activities you have
          selected. Whole-profile sharing has been retired - select
          activities on the map or list first.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        {!hasSelection ? (
          <p className="text-sm text-muted-foreground">
            Select one or more activities on the map or list, then reopen
            this dialog.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {selectedActivities.length} activit
            {selectedActivities.length === 1 ? 'y' : 'ies'} selected.
          </p>
        )}

        <div className="grid gap-2">
          <Label htmlFor="expiry">Link expires after</Label>
          <Select
            value={String(expiresInMs)}
            onValueChange={(value) => setExpiresInMs(Number(value))}
          >
            <SelectTrigger id="expiry">
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

        <div className="grid gap-3">
          <Label>Additional fields to disclose (off by default)</Label>
          {(Object.keys(SHARE_LINK_FIELD_GROUP_LABELS) as (keyof ShareLinkFieldOptions)[]).map(
            (key) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">
                    {SHARE_LINK_FIELD_GROUP_LABELS[key].label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {SHARE_LINK_FIELD_GROUP_LABELS[key].description}
                  </p>
                </div>
                <Switch
                  checked={fields[key]}
                  onCheckedChange={(checked) =>
                    setFields((current) => ({ ...current, [key]: checked }))
                  }
                />
              </div>
            ),
          )}
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => setStep('confirm')} disabled={!hasSelection}>
          Review & confirm
        </Button>
      </DialogFooter>
    </>
  );
}
