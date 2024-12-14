"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";

import Link from "next/link";
import { signIn, signOut } from "next-auth/react";

import { useStore } from "~/contexts/Zustand";
import { useShallow } from "zustand/shallow";

import { SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

import * as React from "react";
import Image from "next/image";

export function UserSettings() {
  const { user, guest, loading, account } = useStore(
    useShallow((state) => ({
      user: state.user,
      account: state.account,
      guest: state.guest,
      loading: state.loading,
    })),
  );

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
                <AvatarImage src={user.image!} alt={user.name} />
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
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            {user && (
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={user.image!} alt={user.name} />
                    <AvatarFallback className="rounded-lg">CN</AvatarFallback>
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
          onClick={() => signIn("strava")}
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
