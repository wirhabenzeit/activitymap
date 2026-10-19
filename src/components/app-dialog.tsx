'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import {
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
  forwardRef,
  useRef,
  useState,
} from 'react';

import { DismissButton } from '~/components/dismiss-button';
import { PopupContainerProvider } from '~/components/popup-container';
import {
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
} from '~/components/ui/dialog';
import { cn } from '~/lib/utils';

// DialogPortal's Presence must observe the animated content, not the unanimated
// positioning wrapper. Keep the popup container outside the clipped content.
const DialogViewport = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    viewportRef: Ref<HTMLDivElement>;
  }
>(({ viewportRef, ...props }, ref) => (
  <div
    ref={viewportRef}
    className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]"
  >
    <DialogPrimitive.Content {...props} ref={ref} />
  </div>
));
DialogViewport.displayName = 'AppDialogViewport';

function dialogFocusOrigin(event: Event): HTMLElement | null {
  const content = event.target;
  if (!(content instanceof HTMLElement)) return null;
  const popupSelector = '[role="menu"], [role="listbox"]';
  // A real persistent DialogTrigger keeps Radix's normal restoration policy.
  const trigger = [
    ...document.querySelectorAll<HTMLElement>(
      '[aria-haspopup="dialog"][aria-controls]',
    ),
  ].find((element) => element.getAttribute('aria-controls') === content.id);
  if (trigger && !trigger.closest(popupSelector)) return null;
  const active = document.activeElement;
  if (
    !(active instanceof HTMLElement) ||
    active === document.body ||
    active === document.documentElement
  )
    return null;
  const popup = active.closest(popupSelector);
  const owner = popup
    ?.getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id))
    .find((element): element is HTMLElement => element instanceof HTMLElement);
  // Menu items disappear on selection. Their labelled trigger is the stable
  // logical origin; trigger-less programmatic dialogs keep their live invoker.
  return owner ?? active;
}

/** Product viewport policy, separate from the generated Radix primitives. */
export function AppDialogContent({
  children,
  className,
  overlayClassName,
  closeLabel,
  showClose = true,
  layout = 'scroll',
  appearance = 'standard',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  closeLabel: string;
  showClose?: boolean;
  layout?: 'scroll' | 'sections';
  appearance?: 'standard' | 'glass';
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const fallbackFocus = useRef<HTMLElement | null>(null);
  return (
    <PopupContainerProvider value={container ?? undefined}>
      <DialogPortal>
        <DialogOverlay className={cn('z-[70]', overlayClassName)} />
        <DialogViewport
          viewportRef={setContainer}
          {...props}
          onOpenAutoFocus={(event) => {
            fallbackFocus.current = dialogFocusOrigin(event);
            onOpenAutoFocus?.(event);
          }}
          onCloseAutoFocus={(event) => {
            if (onCloseAutoFocus) {
              onCloseAutoFocus(event);
              return;
            }
            const origin = fallbackFocus.current;
            if (
              !event.defaultPrevented &&
              origin?.isConnected &&
              origin.getClientRects().length > 0 &&
              !origin.matches(':disabled') &&
              !origin.closest('[inert]')
            ) {
              event.preventDefault();
              origin.focus({ preventScroll: true });
            }
          }}
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
        </DialogViewport>
      </DialogPortal>
    </PopupContainerProvider>
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
