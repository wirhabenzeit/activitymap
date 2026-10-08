'use client';

import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react';
import { ArrowLeft, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { type DetailPresentation } from './inspection';

interface DetailPageProps {
  children: ReactNode;
  detailId: number;
  onBack: () => void;
  backLabel: string;
  navigation?: ReactNode;
  returnFocus: RefObject<HTMLElement | null>;
  presentation?: DetailPresentation;
  onStep?: (direction: -1 | 1) => void;
}

function ownsDetailKeys(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !target.closest(
      '[role="dialog"], [role="menu"], [role="listbox"], [role="slider"], [role="combobox"], input, textarea, select, [contenteditable="true"]',
    )
  );
}

function DetailPage({
  children,
  detailId,
  onBack,
  backLabel,
  navigation,
  returnFocus,
  presentation = 'push',
}: DetailPageProps) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  const backRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
    return () => {
      // Stepping deliberately replaces the origin with the latest inspected row.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const origin = returnFocus.current;
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [detailId]);

  return (
    <motion.section
      aria-label={
        presentation === 'panel'
          ? 'Activity detail panel'
          : 'Activity detail view'
      }
      aria-hidden={!present}
      inert={!present}
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex min-h-0 flex-col bg-background',
        presentation === 'panel'
          ? 'w-[clamp(420px,45%,520px)] border-l'
          : 'left-0',
      )}
      data-detail-presentation={presentation}
      initial={{
        x: reducedMotion ? 0 : '100%',
        opacity: reducedMotion ? 0 : 1,
      }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: reducedMotion ? 0 : '100%', opacity: reducedMotion ? 0 : 1 }}
      transition={{
        duration: reducedMotion ? 0 : 0.28,
        ease: [0.22, 0.75, 0.25, 1],
      }}
    >
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-1 border-b bg-background px-2">
        <Button
          ref={backRef}
          variant="ghost"
          onClick={onBack}
          aria-label={
            presentation === 'panel' ? 'Close activity detail' : backLabel
          }
          className="min-w-0 gap-1 px-1 text-xs sm:px-2 sm:text-sm"
        >
          {presentation === 'panel' ? (
            <X className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="truncate">
            {presentation === 'panel' ? 'Close' : backLabel}
          </span>
        </Button>
        {navigation}
      </div>
      <div
        ref={scrollRef}
        data-detail-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto max-w-5xl">{children}</div>
      </div>
    </motion.section>
  );
}

/** Retain the table and its dimensions throughout a detail round trip. */
export function ListDetailTransition({
  children,
  detail,
  ...props
}: DetailPageProps & {
  detail?: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const open = detail != null;
  const panel = props.presentation === 'panel';
  const { onStep, onBack } = props;
  useEffect(() => {
    if (!open || !onStep) return;
    // Paging can disable the focused pagination button, leaving focus on the
    // document. The List inspector's shortcuts remain available in that case.
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !ownsDetailKeys(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onBack();
      } else if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        onStep(event.key === 'ArrowUp' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [open, onStep, onBack]);
  return (
    <div
      className="relative h-full min-h-0 overflow-hidden"
      data-detail-open={open}
      onKeyDown={(event) => {
        if (!open || onStep || event.defaultPrevented) return;
        const target = event.target as Element;
        if (!event.currentTarget.contains(target) || !ownsDetailKeys(target))
          return;
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onBack();
        }
      }}
    >
      <motion.div
        className={cn(
          'flex h-full min-h-0 min-w-0 flex-col',
          open && panel && 'mr-[clamp(420px,45%,520px)]',
        )}
        inert={open && !panel}
        aria-hidden={open && !panel}
        animate={{
          x: open && !panel && !reducedMotion ? '-16%' : 0,
          opacity: open && !panel ? 0.4 : 1,
        }}
        transition={{
          duration: reducedMotion ? 0 : 0.28,
          ease: [0.22, 0.75, 0.25, 1],
        }}
      >
        {children}
      </motion.div>
      <AnimatePresence initial={false}>
        {open && (
          <DetailPage key="detail" {...props}>
            {detail}
          </DetailPage>
        )}
      </AnimatePresence>
    </div>
  );
}
