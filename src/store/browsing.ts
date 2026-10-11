import { create } from 'zustand';

// Session-only context: no activity payloads or new cross-launch preferences.
export const browsing = create<{
  values: Record<string, unknown>;
  positions: Record<string, { top: number; left: number }>;
}>()(() => ({ values: {}, positions: {} }));

export function resetBrowsingContext() {
  browsing.setState({ values: {}, positions: {} });
}
