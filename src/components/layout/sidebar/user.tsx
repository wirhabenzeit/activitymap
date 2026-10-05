'use client';

import { ChevronsUpDown, LogOut, Loader2, Info } from 'lucide-react';

import { signOut } from '~/lib/auth-client';
import { displayEmail, safeReturnPath } from '~/lib/auth-return';

import { useShallowStore } from '~/store';

import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '~/components/ui/sidebar';
import {
  StravaConnectButton,
  useStravaConnect,
} from '~/components/auth/strava-connect';
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '~/components/ui/dropdown-menu';

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';

import * as React from 'react';
import { cn } from '~/lib/utils';
import {
  checkWebhookStatus,
  createWebhookSubscription,
} from '~/server/strava/actions';
import { env } from '~/env';
import { useToast } from '~/hooks/use-toast';
import { useIsFetching } from '@tanstack/react-query';
import { SettingsDialog } from '~/components/settings/settings-dialog';

export function UserSettings() {
  const { user, isInitialized } = useShallowStore((state) => ({
    user: state.user,
    isInitialized: state.isInitialized,
  }));

  const isFetchingActivities = useIsFetching({ queryKey: ['activities'] }) > 0;
  const isDevelopment = env.NEXT_PUBLIC_ENV === 'development';
  const { toast } = useToast();

  const handleCreateWebhook = async () => {
    try {
      const result = await createWebhookSubscription();

      // Display the result in a toast notification
      toast({
        title: 'Webhook Created',
        description: (
          <div className="space-y-1">
            <p>
              <span className="font-semibold">Success:</span> ✅
            </p>
            <p>
              <span className="font-semibold">ID:</span>{' '}
              {result.subscription?.id}
            </p>
            <p>
              <span className="font-semibold">URL:</span>{' '}
              {result.subscription?.callback_url}
            </p>
          </div>
        ),
        duration: 10000, // Show for 10 seconds
      });

      // Refresh the webhook status
      await handleWebhookStatus();
    } catch (error) {
      console.error('Failed to create webhook:', error);
      toast({
        title: 'Webhook Creation Error',
        description:
          error instanceof Error
            ? error.message
            : 'Unknown error creating webhook',
        variant: 'destructive',
      });
    }
  };

  const handleWebhookStatus = async () => {
    try {
      const result = await checkWebhookStatus();

      // Display the result in a toast notification
      toast({
        title: 'Webhook Status',
        description: (
          <div className="space-y-1">
            <p>
              <span className="font-semibold">URL:</span> {result.expectedUrl}
            </p>
            <p>
              <span className="font-semibold">Status:</span>{' '}
              {result.hasMatchingSubscription ? '✅ Active' : '❌ Not Found'}
            </p>
            <p>
              <span className="font-semibold">Database:</span>{' '}
              {result.databaseStatus === 'synchronized'
                ? '✅ Synced'
                : '❌ Not Synced'}
            </p>
            {result.matchingSubscription && (
              <p>
                <span className="font-semibold">ID:</span>{' '}
                {result.matchingSubscription.id}
              </p>
            )}
          </div>
        ),
        duration: 10000, // Show for 10 seconds
      });
    } catch (error) {
      console.error('Failed to check webhook status:', error);
      toast({
        title: 'Webhook Status Error',
        description:
          error instanceof Error
            ? error.message
            : 'Unknown error checking webhook status',
        variant: 'destructive',
      });
    }
  };

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const email = displayEmail(user?.email);

  // The app shell resolves the session on the server, so a reload is what
  // brings every store and query back in the signed-out state; it keeps the
  // current view rather than jumping elsewhere.
  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({
        title: 'Couldn’t sign out',
        description: 'Please try again.',
        variant: 'destructive',
      });
      return;
    }
    window.location.assign(
      safeReturnPath(`${window.location.pathname}${window.location.search}`),
    );
  };

  if (isInitialized && !user) return <SignedOutAccountRow />;

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <>
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage
                  src={user?.image ?? undefined}
                  alt={user?.name ?? ''}
                />
                <Loader2
                  className={cn(
                    'absolute inset-0 m-auto size-8 text-white animate-spin',
                    {
                      hidden: !isFetchingActivities,
                    },
                  )}
                />
                <AvatarFallback className="rounded-lg"></AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user?.name}</span>
                {email && <span className="truncate text-xs">{email}</span>}
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        {user && (
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name}</p>
                {email && (
                  <p className="text-xs leading-none text-muted-foreground">
                    {email}
                  </p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setSettingsOpen(true)}
              className="cursor-pointer"
            >
              <Info className="mr-2 h-4 w-4" />
              Settings & Status
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isDevelopment && (
              <>
                <DropdownMenuItem
                  onClick={handleWebhookStatus}
                  className="cursor-pointer"
                >
                  <Info className="mr-2 h-4 w-4" />
                  Check Webhook Status
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleCreateWebhook}
                  className="cursor-pointer"
                >
                  <Info className="mr-2 h-4 w-4" />
                  Create Webhook Subscription
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void handleSignOut()}
              className="cursor-pointer text-destructive focus:bg-destructive focus:text-destructive-foreground"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </SidebarMenuItem>
  );
}

/**
 * Signed out: the official Strava button starts the shared connection flow
 * directly. A collapsed icon-only sidebar keeps an equivalent Strava mark.
 */
function SignedOutAccountRow() {
  const { state, isMobile } = useSidebar();
  const { connect, pending } = useStravaConnect();

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          onClick={connect}
          disabled={pending}
          tooltip="Connect with Strava"
          aria-label="Connect with Strava"
        >
          <Avatar className="h-8 w-8 rounded-lg">
            <AvatarImage src="/icon_strava.svg" alt="" />
            <AvatarFallback className="rounded-lg">ST</AvatarFallback>
          </Avatar>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    // Failure feedback lives on the signed-out panel, which is always visible
    // beside this row; repeating it here would only duplicate the message.
    <SidebarMenuItem className="px-1 py-1">
      <StravaConnectButton className="flex-wrap" />
    </SidebarMenuItem>
  );
}
