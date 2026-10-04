import { create } from 'zustand';

export type BrowserSyncStatus = {
  phase: 'idle' | 'syncing' | 'ready' | 'offline' | 'error';
  lastSuccess: string | null;
  error: string | null;
  retryAt: number | null;
};
export const emptyBrowserStatus: BrowserSyncStatus = {
  phase: 'idle',
  lastSuccess: null,
  error: null,
  retryAt: null,
};
export const useBrowserSyncStatus = create<{
  byUser: Record<string, BrowserSyncStatus>;
}>(() => ({ byUser: {} }));
export function updateBrowserSyncStatus(
  userId: string,
  update: Partial<BrowserSyncStatus>,
) {
  useBrowserSyncStatus.setState(({ byUser }) => ({
    byUser: {
      ...byUser,
      [userId]: { ...(byUser[userId] ?? emptyBrowserStatus), ...update },
    },
  }));
}
export const requestBrowserSync = () =>
  window.dispatchEvent(new Event('activitymap:retry-browser-sync'));
