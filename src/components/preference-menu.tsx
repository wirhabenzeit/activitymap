'use client';

import { type ComponentProps } from 'react';

import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSubContent,
} from '~/components/ui/dropdown-menu';
import { cn } from '~/lib/utils';

// Radix computes available height after collision handling, including submenus.
const viewport =
  'max-h-[min(30rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain';
export function PreferenceMenuContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent {...props} className={cn(viewport, className)} />;
}
export function PreferenceMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuSubContent>) {
  return (
    <DropdownMenuSubContent {...props} className={cn(viewport, className)} />
  );
}

/** Independent choices stay open; radio/navigation/destructive actions retain Radix defaults. */
export function PreferenceMenuCheckboxItem({
  onSelect,
  ...props
}: ComponentProps<typeof DropdownMenuCheckboxItem>) {
  return (
    <DropdownMenuCheckboxItem
      {...props}
      onSelect={(event) => {
        onSelect?.(event);
        event.preventDefault();
      }}
    />
  );
}
