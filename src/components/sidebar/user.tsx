'use client';

import { ChevronsUpDown, LogOut, CircleArrowLeft, Loader2 } from 'lucide-react';

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
import { useToast } from '~/hooks/use-toast';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '~/lib/utils';
import { useState } from 'react';
import { User2 } from 'lucide-react';

export function UserSettings() {
  const { user, loading, account, loadFromStrava } = useShallowStore(
    (state) => {
      return {
        user: state.user,
        loading: state.loading,
        account: state.account,
        loadFromStrava: state.loadFromStrava,
      };
    },
  );

  const handleLoadActivities = async () => {
    try {
      console.log('Starting load activities, current loading state:', loading);
      await loadFromStrava({});
      console.log('Finished load activities, current loading state:', loading);
    } catch (error) {
      // Error handling is now done in the server action
      console.error(error);
    }
  };

  return (
    <SidebarMenuItem>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.image!} alt={user.name || ''} />
                <Loader2
                  className={cn(
                    'absolute inset-0 m-auto size-8 text-white animate-spin',
                    {
                      hidden: !loading,
                    },
                  )}
                />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            {user && (
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={user?.image || undefined} />
                    <AvatarFallback>
                      <User2 className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href={`https://www.strava.com/athletes/${account?.providerAccountId}`}
                target="_blank"
              >
                <Image
                  src="/icon_strava.svg"
                  alt="Strava"
                  width={18}
                  height={18}
                />
                Strava Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLoadActivities} disabled={loading}>
              <CircleArrowLeft />
              {loading ? 'Loading...' : 'Get Activities'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {!user && !loading && (
        <SidebarMenuButton
          onClick={() => signIn('strava')}
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
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
        </SidebarMenuButton>
      )}
    </SidebarMenuItem>
  );
}
