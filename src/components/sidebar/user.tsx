'use client';

import {
  ChevronsUpDown,
  LogOut,
  CircleArrowLeft,
  Loader2,
  Info,
} from 'lucide-react';

import Link from 'next/link';
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
import { User2 } from 'lucide-react';
import { checkWebhookStatus } from '~/server/strava/actions';
import { env } from '~/env';

export function UserSettings() {
  const { user, loading, account, loadFromStrava, isInitialized } =
    useShallowStore((state) => ({
      user: state.user,
      loading: state.loading,
      account: state.account,
      loadFromStrava: state.loadFromStrava,
      isInitialized: state.isInitialized,
    }));

  const isDevelopment = env.NEXT_PUBLIC_ENV === 'development';

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
    } catch (error) {
      console.error('Failed to check webhook status:', error);
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
