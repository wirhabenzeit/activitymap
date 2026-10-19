'use client';

import {
  type RefObject,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  type BrowsingKey,
  type BrowsingScrollKey,
  type BrowsingValues,
  browsing,
} from '~/store/browsing';

export function useBrowsingState<K extends BrowsingKey>(
  key: K | undefined,
  initial: BrowsingValues[K],
) {
  const [fallback] = useState(initial);
  const [local, setLocal] = useState(initial);
  const saved = browsing((state) => (key ? state.values[key] : undefined));
  // Null is a valid retained value (for example a cleared calendar day).
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const value = saved === undefined ? (key ? fallback : local) : saved;
  const set = useCallback(
    (update: SetStateAction<BrowsingValues[K]>) => {
      if (!key) {
        setLocal(update);
        return;
      }
      browsing.setState((state) => {
        const previous =
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          state.values[key] === undefined ? fallback : state.values[key];
        const next = typeof update === 'function' ? update(previous) : update;
        return { values: { ...state.values, [key]: next } };
      });
    },
    [key, fallback],
  );
  return [value, set] as const;
}

/** Restore a scroller even when its rows/charts arrive after the first layout. */
export function useRetainedScroll(
  ref: RefObject<HTMLDivElement | null>,
  key: BrowsingScrollKey | undefined,
  selector?: string,
) {
  useLayoutEffect(() => {
    const root = ref.current;
    const element = selector
      ? root?.querySelector(selector)?.parentElement
      : root;
    if (!key || !element) return;
    return retainScroll(element, key);
  }, [ref, key, selector]);
}

// Measure can mount its children after the parent's layout effect. A callback
// ref starts retention when the actual scroller appears, including after resize.
export function useRetainedScrollRef(key: BrowsingScrollKey) {
  const elementRef = useRef<HTMLDivElement>(null);
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      if (element) return retainScroll(element, key);
    },
    [key],
  );
  return [elementRef, attach] as const;
}

function retainScroll(element: HTMLElement, key: BrowsingScrollKey) {
  let pending = browsing.getState().positions[key];
  const restore = () => {
    if (!pending) return;
    element.scrollTo({
      top: pending.top,
      left: pending.left,
      behavior: 'instant',
    });
    if (
      element.scrollHeight - element.clientHeight >= pending.top &&
      element.scrollWidth - element.clientWidth >= pending.left
    )
      pending = undefined;
  };
  const save = () => {
    if (pending) return;
    browsing.setState((state) => ({
      positions: {
        ...state.positions,
        [key]: { top: element.scrollTop, left: element.scrollLeft },
      },
    }));
  };
  // A user gesture takes precedence over an offset awaiting streamed content.
  const interact = () => {
    pending = undefined;
  };
  restore();
  const observer = new ResizeObserver(restore);
  observer.observe(element);
  if (element.firstElementChild) observer.observe(element.firstElementChild);
  element.addEventListener('scroll', save);
  element.addEventListener('wheel', interact, { passive: true });
  element.addEventListener('touchstart', interact, { passive: true });
  element.addEventListener('keydown', interact);
  return () => {
    // Children can already be removed (or hidden by React Activity) here;
    // reading their collapsed viewport would overwrite the last scroll event.
    observer.disconnect();
    element.removeEventListener('scroll', save);
    element.removeEventListener('wheel', interact);
    element.removeEventListener('touchstart', interact);
    element.removeEventListener('keydown', interact);
  };
}
