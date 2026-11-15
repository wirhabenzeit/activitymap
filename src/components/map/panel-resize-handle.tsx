'use client';

import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { cn } from '~/lib/utils';

import {
  type PanelBounds,
  clampPanelHeight,
  panelPercent,
  tapTarget,
} from './panel-bounds';

/** Arrow keys move the edge by one step, Page keys by a larger one. */
const KEY_STEP = 32;
const PAGE_STEP = 160;
/** Movement below this many pixels is a tap, not a drag. */
const TAP_SLOP = 4;
/** Space kept between the panel's top edge and the map's top edge. */
const TOP_CLEARANCE = 16;
/** Height of the header (selection bar) that stays visible when collapsed. */
const FALLBACK_HEADER = 48;

function measure(panel: HTMLElement, handle: HTMLElement): PanelBounds {
  const header =
    panel.querySelector<HTMLElement>('[data-selection-bar]')?.offsetHeight ??
    FALLBACK_HEADER;
  const parent = panel.offsetParent as HTMLElement | null;
  const bottom = Number.parseFloat(getComputedStyle(panel).bottom) || 0;
  const min = handle.offsetHeight + header;
  const max = (parent?.clientHeight ?? window.innerHeight) - bottom;
  return { min, max: Math.max(min, max - TOP_CLEARANCE) };
}

type Drag = {
  pointerId: number;
  startY: number;
  startHeight: number;
  bounds: PanelBounds;
  moved: boolean;
  last: number;
};

/**
 * A draggable top edge for a bottom-anchored panel, matching the iOS results
 * handle. The panel height follows the pointer continuously; a tap toggles
 * between collapsed and fully open. During a drag the height is written
 * straight to the DOM so the (expensive) map tree does not re-render per move,
 * and committed once on release. `height` is the committed value (`null` means
 * the panel's own default size).
 */
export function PanelResizeHandle({
  panelRef,
  height,
  onHeightChange,
  label = 'Results panel',
  className,
}: {
  panelRef: RefObject<HTMLElement | null>;
  height: number | null;
  onHeightChange: (height: number) => void;
  label?: string;
  className?: string;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [percent, setPercent] = useState(100);

  const currentBounds = useCallback(() => {
    const panel = panelRef.current;
    const handle = handleRef.current;
    if (!panel || !handle) return null;
    return {
      bounds: measure(panel, handle),
      height: panel.getBoundingClientRect().height,
    };
  }, [panelRef]);

  // Keep the exposed value in sync with every size change: default sizes,
  // list/detail swaps, window resizes and the drag itself.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const sync = () => {
      const now = currentBounds();
      if (now) setPercent(panelPercent(now.height, now.bounds));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panelRef, currentBounds, height]);

  const apply = (value: number) => {
    const panel = panelRef.current;
    if (panel) panel.style.height = `${value}px`;
  };
  const restore = () => {
    const panel = panelRef.current;
    if (panel) panel.style.height = height === null ? '' : `${height}px`;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const now = currentBounds();
    if (!now) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best effort; the drag still works while the pointer stays over the handle.
    }
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: now.height,
      bounds: now.bounds,
      moved: false,
      last: now.height,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (state?.pointerId !== event.pointerId) return;
    const delta = state.startY - event.clientY;
    if (!state.moved && Math.abs(delta) < TAP_SLOP) return;
    state.moved = true;
    state.last = clampPanelHeight(state.startHeight + delta, state.bounds);
    apply(state.last);
  };

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const state = drag.current;
    if (state?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) return restore();
    onHeightChange(
      state.moved ? state.last : tapTarget(state.startHeight, state.bounds),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const now = currentBounds();
    if (!now) return;
    const { bounds } = now;
    const steps: Record<string, number> = {
      ArrowUp: KEY_STEP,
      ArrowDown: -KEY_STEP,
      PageUp: PAGE_STEP,
      PageDown: -PAGE_STEP,
    };
    let next: number | undefined;
    if (event.key in steps) next = now.height + steps[event.key]!;
    else if (event.key === 'Home') next = bounds.min;
    else if (event.key === 'End') next = bounds.max;
    else if (event.key === 'Enter' || event.key === ' ')
      next = tapTarget(now.height, bounds);
    if (next === undefined) return;
    event.preventDefault();
    onHeightChange(clampPanelHeight(next, bounds));
  };

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={
        percent <= 0
          ? 'Collapsed'
          : percent >= 100
            ? 'Expanded'
            : `${percent}% of available height`
      }
      title="Drag to resize"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative z-10 -mb-1 flex h-4 w-full shrink-0 cursor-row-resize touch-none items-center justify-center select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-1 w-9 rounded-full bg-muted-foreground/50 transition-colors group-hover:bg-muted-foreground group-focus-visible:bg-muted-foreground"
      />
    </div>
  );
}
