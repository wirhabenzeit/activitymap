'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import { type ComponentProps, type ReactNode } from 'react';

import { DismissButton } from '~/components/dismiss-button';
import {
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
} from '~/components/ui/dialog';
import { cn } from '~/lib/utils';

/** Product viewport policy, separate from the generated Radix primitives. */
export function AppDialogContent({
  children,
  className,
  overlayClassName,
  closeLabel,
  showClose = true,
  layout = 'scroll',
  appearance = 'standard',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  closeLabel: string;
  showClose?: boolean;
  layout?: 'scroll' | 'sections';
  appearance?: 'standard' | 'glass';
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={cn('z-[70]', overlayClassName)} />
      <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <DialogPrimitive.Content
          {...props}
          data-app-dialog=""
          className={cn(
            'pointer-events-auto relative flex max-h-full min-h-0 w-full max-w-md flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-lg',
            'duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:!animate-none',
            appearance === 'glass' &&
              'border-white/20 bg-card/75 text-card-foreground shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/10',
            className,
          )}
        >
          {layout === 'scroll' ? (
            <AppDialogBody>{children}</AppDialogBody>
          ) : (
            children
          )}
          {showClose && (
            <DialogPrimitive.Close asChild>
              <DismissButton
                label={closeLabel}
                className="absolute top-1 right-1"
              />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
}

export function AppDialogHeader({
  className,
  ...props
}: ComponentProps<typeof DialogHeader>) {
  return (
    <DialogHeader
      {...props}
      className={cn('shrink-0 px-5 py-4 pr-14 text-left', className)}
    />
  );
}
export function AppDialogBody({
  children,
  className,
  asChild = false,
}: {
  children: ReactNode;
  className?: string;
  asChild?: boolean;
}) {
  const Component = asChild ? Slot : 'div';
  return (
    <Component
      data-app-dialog-body=""
      className={cn(
        'min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5',
        className,
      )}
    >
      {children}
    </Component>
  );
}
export function AppDialogFooter({
  className,
  ...props
}: ComponentProps<typeof DialogFooter>) {
  return (
    <DialogFooter
      {...props}
      className={cn(
        'shrink-0 gap-2 border-t px-5 py-3 sm:justify-between sm:space-x-0',
        className,
      )}
    />
  );
}
