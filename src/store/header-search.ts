'use client';

import { create } from 'zustand';

/** Header search is transient: acting on a result, applying a filter or
 * leaving the view ends it. Looking at results within the List (opening a
 * detail and going back, selecting rows) keeps it. Never persisted. */
export const useHeaderSearch = create<{
  active: boolean;
  query: string;
  /** Set while a List is on screen: its rows narrow instead of a panel. */
  narrowsRows: boolean;
  begin: () => void;
  end: () => void;
  setQuery: (query: string) => void;
}>((set) => ({
  active: false,
  query: '',
  narrowsRows: false,
  begin: () => set({ active: true }),
  end: () => set({ active: false, query: '' }),
  setQuery: (query) => set({ query }),
}));
