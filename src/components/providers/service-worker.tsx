'use client';

import { useEffect } from 'react';

export function ServiceWorkerProvider() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
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
