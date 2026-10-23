'use client';

import { create } from 'zustand';

type PlaceFocus = {
  userId: string;
  activityId: string;
  placeId: string;
  visitIndex: number;
  source: 'map' | 'profile';
};
export const useActivityPlaceFocus = create<{
  sequence: number;
  focus: (PlaceFocus & { sequence: number }) | null;
  setFocus: (focus: PlaceFocus) => void;
}>((set) => ({
  sequence: 0,
  focus: null,
  setFocus: (focus) =>
    set((state) => ({
      sequence: state.sequence + 1,
      focus: { ...focus, sequence: state.sequence + 1 },
    })),
}));

export function resetActivityPlaceFocus() {
  useActivityPlaceFocus.setState({ focus: null });
}
