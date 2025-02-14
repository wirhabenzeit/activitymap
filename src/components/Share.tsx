'use client';

import { useState } from 'react';

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

export function ShareButton() {
  const { selected } = useShallowStore((state) => ({
    selected: state.selected,
  }));
  const [selectedValue, setSelectedValue] = useState(false);
  const shareUrl = new URL('https://activitymap.dominik.page');

  if (selectedValue)
    shareUrl.searchParams.append('activities', selected.join(','));

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
            Create a shareable link to this map, displaying the selected
            activities.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center space-x-2">
          <Switch
            id="selected-mode"
            checked={selectedValue}
            onCheckedChange={setSelectedValue}
          />
          <Label htmlFor="selected-mode">Include Selected</Label>
        </div>
        <div className="flex items-center space-x-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="link" className="sr-only">
              Link
            </Label>
            <Input id="link" value={shareUrl.toString()} readOnly />
          </div>
          <Button type="submit" size="sm" className="px-3">
            <span className="sr-only">Copy</span>
            <Copy />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
