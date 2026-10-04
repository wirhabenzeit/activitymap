'use client';

import { useEffect } from 'react';

export function ServiceWorkerProvider() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    // Development chunks reuse URLs across edits. An offline worker can serve
    // stale module factories even after a reload, so retire only our own worker.
    if (process.env.NODE_ENV === 'development') {
      void navigator.serviceWorker
        .getRegistrations()
        .then(async (registrations) => {
          await Promise.all(
            registrations.map(async (registration) => {
              const worker =
                registration.active ??
                registration.waiting ??
                registration.installing;
              if (
                worker?.scriptURL ===
                new URL('/sw.js', window.location.origin).href
              ) {
                await registration.unregister();
              }
            }),
          );
        })
        .catch((error: unknown) =>
          console.error('Development service worker cleanup failed:', error),
        );
      return;
    }

    let isActive = true;

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        if (!isActive) {
          return;
        }

        // Ask the browser to check for new worker code after registration.
        void registration.update();
      } catch (error) {
        console.error('Service worker registration failed:', error);
      }
    };

    void registerServiceWorker();

    return () => {
      isActive = false;
    };
  }, []);

  return null;
}
