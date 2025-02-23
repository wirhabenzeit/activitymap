'use client';

import { useState, useEffect } from 'react';

import { Share as ShareIcon, Copy } from 'lucide-react';

import { useShallowStore } from '~/store';
import { Switch } from '~/components/ui/switch';
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

export function ShareButton() {
  const { selected, user, isGuest } = useShallowStore((state) => ({
    selected: state.selected,
    user: state.user,
    isGuest: state.isGuest,
  }));

  // Don't render anything in guest mode
  if (isGuest) return null;

  const [shareMode, setShareMode] = useState<'selected' | 'profile'>(
    'selected',
  );
  const [shareUrl, setShareUrl] = useState<string>('');
  const { toast } = useToast();
  const [publicIds, setPublicIds] = useState<number[]>([]);

  useEffect(() => {
    const fetchPublicIds = async () => {
      if (shareMode === 'selected' && selected.length > 0) {
        try {
          const response = await fetch(
            `/api/activities?ids=${selected.join(',')}`,
          );
          const activities = await response.json();
          const ids = activities.map(
            (activity: { public_id: number }) => activity.public_id,
          );
          setPublicIds(ids);
        } catch (error) {
          console.error('Error fetching public IDs:', error);
          toast({
            title: 'Error',
            description: 'Failed to generate share link',
            variant: 'destructive',
          });
        }
      }
    };
    fetchPublicIds();
  }, [shareMode, selected, toast]);

  useEffect(() => {
    const url = new URL(window.location.origin);
    if (shareMode === 'selected' && publicIds.length > 0) {
      url.searchParams.append('activities', publicIds.join(','));
    } else if (shareMode === 'profile' && user?.id) {
      url.searchParams.append('user', user.id);
    }
    setShareUrl(url.toString());
  }, [shareMode, publicIds, user]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    toast({
      title: 'Copied!',
      description: 'Share link has been copied to clipboard',
    });
  };

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
          <DialogTitle>Share Link</DialogTitle>
          <DialogDescription>
            Create a shareable link to this map. Choose what you want to share.
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
                className={selected.length === 0 ? 'text-muted-foreground' : ''}
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
  );
}
