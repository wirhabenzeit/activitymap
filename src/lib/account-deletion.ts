'use client';

import { deleteAccountResultSchema } from '~/contracts/v1/account-deletion';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { clearV1Scope, deleteLegacyOfflineDatabase } from '~/lib/sync/v1-store';

export const ACCOUNT_DELETED_STORAGE_KEY = 'activitymap:account-deleted';
let cleanup: ((userId: string) => Promise<void>) | undefined;

export function registerAccountDeletionCleanup(
  handler: (userId: string) => Promise<void>,
) {
  cleanup = handler;
  return () => {
    if (cleanup === handler) cleanup = undefined;
  };
}

/** Clear this device after successful sign-out or account deletion. */
export async function clearLocalAccountData(userId: string) {
  if (cleanup) await cleanup(userId);
  else await clearV1Scope(`auth:${userId}`);
  await deleteLegacyOfflineDatabase();
  // Navigations in the offline shell can contain the last signed-in profile.
  const worker = navigator.serviceWorker?.controller;
  if (worker) {
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        reject(new Error('Offline cache cleanup timed out'));
      }, 5000);
      channel.port1.onmessage = () => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve();
      };
      worker.postMessage({ type: 'CLEAR_ACCOUNT_DATA' }, [channel.port2]);
    });
  } else if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('activitymap-'))
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- browser CacheStorage, not a database table
        .map((name) => caches.delete(name)),
    );
  }
}

// Existing deletion callers use exactly the same scoped cleanup boundary.
export const clearDeletedAccountData = clearLocalAccountData;

export async function deleteAccount() {
  const response = await fetch('/api/v1/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE' }),
  });
  if (!response.ok) throw new Error('Account deletion failed');
  responseEnvelope(deleteAccountResultSchema).parse(await response.json());
}

export function notifyAccountDeleted(userId: string) {
  // A storage event stops and clears other open tabs using the same account.
  try {
    localStorage.setItem(
      ACCOUNT_DELETED_STORAGE_KEY,
      JSON.stringify({ userId, at: Date.now() }),
    );
  } catch {
    /* Storage can be unavailable. */
  }
}

export function wasAccountDeleted(userId: string): boolean {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(ACCOUNT_DELETED_STORAGE_KEY) ?? 'null',
    );
    return (
      typeof value === 'object' &&
      value !== null &&
      'userId' in value &&
      value.userId === userId
    );
  } catch {
    return false;
  }
}
