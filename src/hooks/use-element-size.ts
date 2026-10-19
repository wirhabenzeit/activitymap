'use client';

import { useCallback, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
  ready: boolean;
}

/** Observe the current element, including replacements and React Activity reactivation. */
export function useElementSize<T extends HTMLElement = HTMLDivElement>({
  retainSize = false,
  box = 'content',
  initialWidth = 0,
  initialHeight = 0,
}: {
  retainSize?: boolean;
  box?: 'content' | 'client';
  initialWidth?: number;
  initialHeight?: number;
} = {}) {
  const [size, setSize] = useState<ElementSize>({
    width: initialWidth,
    height: initialHeight,
    ready: false,
  });
  const ref = useCallback(
    (element: T | null) => {
      if (!element) return;
      let observing = true;
      const update = (width: number, height: number) => {
        if (!observing || (retainSize && (width <= 0 || height <= 0))) return;
        setSize((previous) =>
          previous.ready &&
          previous.width === width &&
          previous.height === height
            ? previous
            : { width, height, ready: true },
        );
      };
      const measure = (entry?: ResizeObserverEntry) => {
        if (box === 'client') update(element.clientWidth, element.clientHeight);
        else if (entry)
          update(entry.contentRect.width, entry.contentRect.height);
        else {
          const style = getComputedStyle(element);
          update(
            element.clientWidth -
              parseFloat(style.paddingLeft || '0') -
              parseFloat(style.paddingRight || '0'),
            element.clientHeight -
              parseFloat(style.paddingTop || '0') -
              parseFloat(style.paddingBottom || '0'),
          );
        }
      };
      measure();
      const observer = new ResizeObserver(([entry]) => measure(entry));
      observer.observe(element);
      return () => {
        observing = false;
        observer.disconnect();
      };
    },
    [box, retainSize],
  );
  return [ref, size] as const;
}
