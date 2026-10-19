'use client';
import { type KeyboardEvent, useRef, useState } from 'react';

import { type DayGridLayout, dayGridTarget } from '~/lib/stats/day-grid';

export function useDayGrid(
  first: number,
  last: number,
  initial: number,
  layout: DayGridLayout,
) {
  const [focused, setFocused] = useState(initial);
  const current = Math.max(first, Math.min(last, focused));
  const cells = useRef(new Map<number, HTMLButtonElement>());
  return (day: number) => ({
    ref: (element: HTMLButtonElement | null) => {
      if (element) cells.current.set(day, element);
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- DOM refs, not database rows.
      else cells.current.delete(day);
    },
    tabIndex: day === current ? 0 : -1,
    onFocus: () => setFocused(day),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const next = dayGridTarget(
        day,
        event.key,
        first,
        last,
        layout,
        getComputedStyle(event.currentTarget).direction === 'rtl',
      );
      if (next === null) return;
      event.preventDefault();
      cells.current.get(next)?.focus();
    },
  });
}
