'use client';

import { useMemo, useState } from 'react';

import { Share as ShareIcon, Copy } from 'lucide-react';

import { useShallowStore } from '~/store';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group';
import { useToast } from '~/hooks/use-toast';

import { useActivities } from '~/hooks/use-activities';
import { appendMapShareParams } from '~/lib/map-share';
import { defaultMapPosition } from '~/settings/map';
import {
  LEGACY_SHARING_ENABLED,
  LEGACY_SHARING_ISSUE_URL,
} from '~/lib/legacy-sharing';

/**
 * Part of #132: the legacy `/map?user=`/`/map?activities=` sharing flow is
 * disabled (see `~/lib/legacy-sharing.ts` and docs/strava-data-policy.md
 * §5) because it produced permanent, non-revocable, guessable-identifier
 * links. Rather than offer a button that generates a link that no longer
 * works, this renders a disabled state explaining why while the real
 * replacement (scoped, expiring, revocable private links) is built.
 */
function DisabledShareButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 px-0">
          <ShareIcon className="h-4 w-4" />
          <span className="sr-only">Share</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Sharing is being redesigned</DialogTitle>
          <DialogDescription>
            Link-based sharing is temporarily disabled. The previous links
            never expired and could not be revoked, so they have been turned
            off while they are replaced with secure, expiring private links
            you control. Any share link created earlier no longer grants
            access.{' '}
            <a
              href={LEGACY_SHARING_ISSUE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Track progress in issue #132.
            </a>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export function ShareButton() {
  const isGuest = useShallowStore((state) => state.isGuest);

  // A guest (someone viewing via a - now-disabled - shared link) never had
  // a share button of their own; preserve that regardless of the flag.
  if (isGuest) {
    return null;
  }

  if (!LEGACY_SHARING_ENABLED) {
    return <DisabledShareButton />;
  }

  return <LegacyShareButton />;
}

/**
 * Original share-link implementation, kept in place (not deleted) so it is
 * easy to re-enable or reuse once it is replaced. See `ShareButton` above
 * for the current, disabled entry point.
 */
function LegacyShareButton() {
  const {
    selected,
    user,
    isGuest,
    baseMap,
    overlayMaps,
    position,
    threeDim,
    showPhotos,
  } = useShallowStore(
    (state) => ({
      selected: state.selected,
      user: state.user,
      isGuest: state.isGuest,
      baseMap: state.baseMap,
      overlayMaps: state.overlayMaps,
      position: state.position,
      threeDim: state.threeDim,
      showPhotos: state.showPhotos,
    }),
  );

  const { data: activities = [] } = useActivities();

  const [shareMode, setShareMode] = useState<'selected' | 'profile'>(
    'selected',
  );
  const { toast } = useToast();

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    const url = new URL('/map', window.location.origin);
    if (shareMode === 'selected' && selected.length > 0) {
      // Get public_ids from activities for sharing
      const publicIds = activities
        .filter((act) => selected.includes(act.id))
        .map((act) => act.public_id)
        .filter(Boolean);
      url.searchParams.append('activities', publicIds.join(','));
    } else if (shareMode === 'profile' && user?.id) {
      url.searchParams.append('user', user.id);
    }

    appendMapShareParams(url, {
      baseMap,
      overlayMaps,
      position: {
        longitude: position.longitude,
        latitude: position.latitude,
        zoom: position.zoom,
        bearing: position.bearing ?? defaultMapPosition.bearing,
        pitch: position.pitch ?? defaultMapPosition.pitch,
        padding: position.padding ?? defaultMapPosition.padding,
      },
      threeDim,
      showPhotos,
    });

    return url.toString();
  }, [
    shareMode,
    selected,
    user,
    activities,
    baseMap,
    overlayMaps,
    position,
    threeDim,
    showPhotos,
  ]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    toast({
      title: 'Copied!',
      description: 'Share link has been copied to clipboard',
    });
  };

  return (
    !isGuest && (
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 px-0">
            <ShareIcon className="h-4 w-4" />
            <span className="sr-only">Share</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Share Link</DialogTitle>
            <DialogDescription>
              Create a shareable link to this map. Choose what you want to
              share.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <RadioGroup
              value={shareMode}
              onValueChange={(value: string) =>
                setShareMode(value as 'selected' | 'profile')
              }
              className="grid gap-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="selected"
                  id="selected"
                  disabled={selected.length === 0}
                />
                <Label
                  htmlFor="selected"
                  className={
                    selected.length === 0 ? 'text-muted-foreground' : ''
                  }
                >
                  Share Selected Activities{' '}
                  {selected.length === 0 && '(Select activities first)'}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="profile"
                  id="profile"
                  disabled={!user?.id}
                />
                <Label
                  htmlFor="profile"
                  className={!user?.id ? 'text-muted-foreground' : ''}
                >
                  Share Entire Profile {!user?.id && '(Login required)'}
                </Label>
              </div>
            </RadioGroup>
            <div className="flex items-center space-x-2">
              <div className="grid flex-1 gap-2">
                <Label htmlFor="link" className="sr-only">
                  Link
                </Label>
                <Input
                  id="link"
                  value={shareUrl}
                  readOnly
                  disabled={
                    (shareMode === 'selected' && selected.length === 0) ||
                    (shareMode === 'profile' && !user?.id)
                  }
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="px-3"
                onClick={handleCopy}
                disabled={
                  (shareMode === 'selected' && selected.length === 0) ||
                  (shareMode === 'profile' && !user?.id)
                }
              >
                <span className="sr-only">Copy</span>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  );
}
