import { create } from 'zustand';
import type { StreamSummaryResult } from '~/lib/activity-stream-summary';

export type ElevationCursor = {
  owner: string;
  userId: string;
  activityId: string;
  coordinate: [number, number]; // latitude, longitude, aligned with altitude
  source: StreamSummaryResult;
};

// Transient interaction state: no persistence or localStorage writes while scrubbing.
export const useElevationCursor = create<{
  cursor: ElevationCursor | null;
  setCursor: (cursor: ElevationCursor) => void;
  clearCursor: (owner: string) => void;
}>((set) => ({
  cursor: null,
  setCursor: (cursor) => set({ cursor }),
  clearCursor: (owner) =>
    set((state) => (state.cursor?.owner === owner ? { cursor: null } : state)),
}));
