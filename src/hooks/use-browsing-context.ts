'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type SetStateAction,
} from 'react';
import { browsing } from '~/store/browsing';

export function useBrowsingState<T>(key: string | undefined, initial: T) {
  const [fallback] = useState(initial);
  const [local, setLocal] = useState(initial);
  const saved = browsing((state) => (key ? state.values[key] : undefined));
  const value = saved === undefined ? (key ? fallback : local) : (saved as T);
  const set = useCallback(
    (update: SetStateAction<T>) => {
      if (!key) {
        setLocal(update);
        return;
      }
      browsing.setState((state) => {
        const previous =
          state.values[key] === undefined ? fallback : (state.values[key] as T);
        const next =
          typeof update === 'function'
            ? (update as (value: T) => T)(previous)
            : update;
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
  key: string | undefined,
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
export function useRetainedScrollRef(key: string) {
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

function retainScroll(element: HTMLElement, key: string) {
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
