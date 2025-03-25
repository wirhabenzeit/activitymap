'use client';

import {
  ChevronsUpDown,
  LogOut,
  CircleArrowLeft,
  Loader2,
  Info,
} from 'lucide-react';

import { signIn, signOut } from 'next-auth/react';

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
import { checkWebhookStatus, createWebhookSubscription } from '~/server/strava/actions';
import { env } from '~/env';
import { useToast } from '~/hooks/use-toast';

export function UserSettings() {
  const { user, loading, loadFromStrava, isInitialized } = useShallowStore(
    (state) => ({
      user: state.user,
      loading: state.loading,
      loadFromStrava: state.loadFromStrava,
      isInitialized: state.isInitialized,
    }),
  );

  const isDevelopment = env.NEXT_PUBLIC_ENV === 'development';
  const { toast } = useToast();

  const handleCreateWebhook = async () => {
    try {
      const result = await createWebhookSubscription();
      console.log('Webhook creation result:', result);
      
      // Display the result in a toast notification
      toast({
        title: 'Webhook Created',
        description: (
          <div className="space-y-1">
            <p>
              <span className="font-semibold">Success:</span> ✅
            </p>
            <p>
              <span className="font-semibold">ID:</span> {result.subscription.id}
            </p>
            <p>
              <span className="font-semibold">URL:</span> {result.subscription.callback_url}
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
        description: error instanceof Error ? error.message : 'Unknown error creating webhook',
        variant: 'destructive',
      });
    }
  };

  const handleWebhookStatus = async () => {
    try {
      const result = await checkWebhookStatus();
      console.log('Webhook status:', {
        expectedUrl: result.expectedUrl,
        hasMatchingSubscription: result.hasMatchingSubscription,
        databaseStatus: result.databaseStatus,
        matchingSubscription: result.matchingSubscription,
        subscriptions: result.subscriptions,
      });
      
      // Display the result in a toast notification
      toast({
        title: 'Webhook Status',
        description: (
          <div className="space-y-1">
            <p>
              <span className="font-semibold">URL:</span> {result.expectedUrl}
            </p>
            <p>
              <span className="font-semibold">Status:</span> {result.hasMatchingSubscription ? '✅ Active' : '❌ Not Found'}
            </p>
            <p>
              <span className="font-semibold">Database:</span> {result.databaseStatus === 'synchronized' ? '✅ Synced' : '❌ Not Synced'}
            </p>
            {result.matchingSubscription && (
              <p>
                <span className="font-semibold">ID:</span> {result.matchingSubscription.id}
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
        description: error instanceof Error ? error.message : 'Unknown error checking webhook status',
        variant: 'destructive',
      });
    }
  };

  const handleLoadNewestActivities = async () => {
    try {
      console.log('Starting load newest activities, current loading state:', loading);
      await loadFromStrava({ photos: true, fetchNewest: true });
      console.log('Finished load newest activities, current loading state:', loading);
    } catch (error) {
      console.error(error);
    }
  };

  const handleLoadOlderActivities = async () => {
    try {
      console.log('Starting load older activities, current loading state:', loading);
      await loadFromStrava({ photos: true, fetchNewest: false });
      console.log('Finished load older activities, current loading state:', loading);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            onClick={
              !isInitialized || user ? undefined : () => signIn('strava')
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
                        hidden: !loading,
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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={loading} className="cursor-pointer gap-2">
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CircleArrowLeft className="mr-2 h-4 w-4" />
                )}
                <span>Get Activities</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-56 rounded-lg">
                  <DropdownMenuItem
                    onClick={handleLoadNewestActivities}
                    disabled={loading}
                    className="cursor-pointer"
                  >
                    Get Newest Activities
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleLoadOlderActivities}
                    disabled={loading}
                    className="cursor-pointer"
                  >
                    Get Older Activities
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
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
    </SidebarMenuItem>
  );
}
