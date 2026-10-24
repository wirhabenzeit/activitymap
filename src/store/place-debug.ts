'use client';

import { create } from 'zustand';

/** Session-only and account-scoped. Never hydrate this from browser storage. */
export const usePlaceDebug = create<{
  userId: string | null;
  setEnabled: (userId: string, enabled: boolean) => void;
}>((set) => ({
  userId: null,
  setEnabled: (userId, enabled) => set({ userId: enabled ? userId : null }),
}));
