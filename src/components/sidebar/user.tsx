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
} from '~/components/ui/dropdown-menu';

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '~/lib/utils';
import { checkWebhookStatus } from '~/server/strava/actions';
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

  const handleLoadActivities = async () => {
    try {
      console.log('Starting load activities, current loading state:', loading);
      await loadFromStrava({ photos: true });
      console.log('Finished load activities, current loading state:', loading);
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
            <DropdownMenuItem
              onClick={handleLoadActivities}
              disabled={loading}
              className="cursor-pointer"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CircleArrowLeft className="mr-2 h-4 w-4" />
              )}
              Get Activities
            </DropdownMenuItem>
            {isDevelopment && (
              <DropdownMenuItem
                onClick={handleWebhookStatus}
                className="cursor-pointer"
              >
                <Info className="mr-2 h-4 w-4" />
                Check Webhook Status
              </DropdownMenuItem>
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
