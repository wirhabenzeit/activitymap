'use client';

import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '~/components/ui/button';

interface DetailPageProps {
  children: ReactNode;
  detailId: number;
  onBack: () => void;
  backLabel: string;
  navigation?: ReactNode;
  returnFocus: RefObject<HTMLElement | null>;
}

function DetailPage({
  children,
  detailId,
  onBack,
  backLabel,
  navigation,
  returnFocus,
}: DetailPageProps) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  const backRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const origin = returnFocus.current;
    backRef.current?.focus({ preventScroll: true });
    return () => {
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [detailId]);

  return (
    <motion.section
      aria-label="Activity detail view"
      aria-hidden={!present}
      inert={!present}
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background"
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
          aria-label={backLabel}
          className="min-w-0 gap-1 px-1 text-xs sm:px-2 sm:text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span className="truncate">{backLabel}</span>
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
  return (
    <div
      className="relative h-full min-h-0 overflow-hidden"
      data-detail-open={open}
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape' || event.defaultPrevented) return;
        const target = event.target as Element;
        if (
          !event.currentTarget.contains(target) ||
          target.closest('[role="dialog"], [role="menu"]')
        )
          return;
        event.preventDefault();
        props.onBack();
      }}
    >
      <motion.div
        className="flex h-full min-h-0 flex-col"
        inert={open}
        aria-hidden={open}
        animate={{
          x: open && !reducedMotion ? '-16%' : 0,
          opacity: open ? 0.4 : 1,
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
