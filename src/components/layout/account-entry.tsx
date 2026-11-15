'use client';

import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { SettingsDialog } from '~/components/settings/settings-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { Button } from '~/components/ui/button';
import { useActivityLoadIndicator } from '~/hooks/use-activity-load-indicator';
import { message } from '~/lib/presentation/messages';
import { cn } from '~/lib/utils';
import { useShallowStore } from '~/store';

import { settingsDialogState } from './settings-dialog-state';

const useSettingsDialogOpen = () =>
  React.useSyncExternalStore(
    settingsDialogState.subscribe,
    settingsDialogState.get,
    () => false,
  );

/** The one Settings dialog, mounted with the header so it outlives the
 * sidebar (a closed mobile sidebar unmounts its content). Signed out, the
 * connect dialog over the app is the account entry point instead. */
export function SettingsDialogHost() {
  const open = useSettingsDialogOpen();
  const signedIn = useShallowStore((state) => Boolean(state.user));
  if (!signedIn) return null;
  return <SettingsDialog open={open} onOpenChange={settingsDialogState.set} />;
}

/** Always-visible account entry at the right end of the header; it opens
 * Settings directly and carries the quiet activity-loading indicator. */
export function AccountButton({ className }: { className?: string }) {
  const user = useShallowStore((state) => state.user);
  const loading = useActivityLoadIndicator();
  if (!user) return null;
  const initial = (user.name ?? user.email ?? '').trim().charAt(0);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-account-button
        aria-label={message('navigation.settings')}
        aria-haspopup="dialog"
        className={cn('relative h-11 w-11 shrink-0', className)}
        onClick={() => settingsDialogState.set(true)}
      >
        <Avatar className="size-8">
          <AvatarImage src={user.image ?? undefined} alt="" />
          <AvatarFallback className="bg-header-foreground/20 text-sm font-semibold text-header-foreground uppercase">
            {initial}
          </AvatarFallback>
          {/* Stays mounted, so the rotation never restarts between pages. */}
          <Loader2
            aria-hidden
            className={cn(
              'absolute inset-0 m-auto size-8 animate-spin text-white transition-opacity duration-300 motion-reduce:animate-none',
              loading ? 'opacity-100' : 'opacity-0',
            )}
          />
        </Avatar>
      </Button>
      <span role="status" className="sr-only">
        {loading ? 'Loading activities' : ''}
      </span>
    </>
  );
}
