'use client';

import {
  ChevronsUpDown,
  LogOut,
  CircleArrowLeft,
  Loader2,
  Info,
} from 'lucide-react';

import { signIn, signOut } from '~/lib/auth-client';

import { useShallowStore } from '~/store';

import { SidebarMenuButton, SidebarMenuItem } from '~/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '~/components/ui/dropdown-menu';

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '~/lib/utils';
import {
  checkWebhookStatus,
  createWebhookSubscription,
} from '~/server/strava/actions';
import { env } from '~/env';
import { useToast } from '~/hooks/use-toast';
import { useActivities } from '~/hooks/use-activities';

import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import { fetchStravaActivities } from '~/server/strava/actions';
import { SettingsDialog } from '~/components/settings/settings-dialog';

export function UserSettings() {
  const { user, account, isInitialized } = useShallowStore(
    (state) => ({
      user: state.user,
      account: state.account,
      isInitialized: state.isInitialized,
    }),
  );

  const { data: activities = [] } = useActivities();

  const [loading, setLoading] = React.useState(false);
  const queryClient = useQueryClient();
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

  const handleLoadNewestActivities = async () => {
    if (!account) return;
    setLoading(true);
    try {
      const result = await fetchStravaActivities({
        accessToken: account.access_token!,
        athleteId: parseInt(account.providerAccountId),
        includePhotos: true,
      });

      await queryClient.invalidateQueries({ queryKey: ['activities'] });
      await queryClient.invalidateQueries({ queryKey: ['photos'] });

      toast({
        title: 'Activities Loaded',
        description: `Successfully loaded ${result.activities.length} new activities.`,
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error',
        description: 'Failed to load newest activities.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLoadOlderActivities = async () => {
    if (!account) return;
    setLoading(true);
    try {
      // Find the oldest activity date to fetch before it
      let beforeTimestamp: number | undefined;
      if (activities.length > 0) {
        const oldestDate = activities.reduce((min, act) => {
          const actDate = new Date(act.start_date).getTime();
          return actDate < min ? actDate : min;
        }, Date.now());
        beforeTimestamp = Math.floor(oldestDate / 1000);
      }

      const result = await fetchStravaActivities({
        accessToken: account.access_token!,
        athleteId: parseInt(account.providerAccountId),
        includePhotos: true,
        before: beforeTimestamp,
      });

      await queryClient.invalidateQueries({ queryKey: ['activities'] });
      await queryClient.invalidateQueries({ queryKey: ['photos'] });

      toast({
        title: 'Activities Loaded',
        description: `Successfully loaded ${result.activities.length} older activities.`,
      });

    } catch (error) {
      console.error(error);
      toast({
        title: 'Error',
        description: 'Failed to load older activities.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };


  const [settingsOpen, setSettingsOpen] = React.useState(false);

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            onClick={
              !isInitialized || user
                ? undefined
                : () => signIn.social({ provider: 'strava' })
            }
          >
            {user || !isInitialized ? (
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
                        hidden: !loading && !isFetchingActivities,
                      },
                    )}
                  />
                  <AvatarFallback className="rounded-lg"></AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user?.name}</span>
                  <span className="truncate text-xs">{user?.email}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </>
            ) : (
              !loading && (
                <>
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src="/icon_strava.svg" alt="Strava" />
                    <AvatarFallback className="rounded-lg">ST</AvatarFallback>
                  </Avatar>
                  <Image
                    src="/btn_strava.svg"
                    alt="Strava Login Icon"
                    width={185}
                    height={40}
                  />
                </>
              )
            )}
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
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email}
                </p>
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
              onClick={() => signOut()}
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
