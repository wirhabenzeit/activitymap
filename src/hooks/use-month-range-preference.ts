'use client';

import { useSyncExternalStore } from 'react';

function rangePreference(period: 'month' | 'year') {
  // Preserve the existing month key when extending this preference to years.
  const key = `activitymap.stats.${period}-typical-range`;
  const changedEvent = `activitymap-${period}-range-change`;
  let volatileValue: boolean | undefined;
  const snapshot = () => {
    if (volatileValue !== undefined) return volatileValue;
    try {
      return localStorage.getItem(key) !== 'false';
    } catch {
      return true;
    }
  };
  const subscribe = (listener: () => void) => {
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return;
      volatileValue = undefined;
      listener();
    };
    window.addEventListener('storage', storageChanged);
    window.addEventListener(changedEvent, listener);
    return () => {
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener(changedEvent, listener);
    };
  };
  const set = (value: boolean) => {
    volatileValue = value;
    try {
      localStorage.setItem(key, String(value));
      volatileValue = undefined;
    } catch {
      // Keep the choice for this session if browser storage is unavailable.
    }
    window.dispatchEvent(new Event(changedEvent));
  };
  return { subscribe, snapshot, set };
}
const preferences = {
  month: rangePreference('month'),
  year: rangePreference('year'),
};

export function useHistoricalRangePreference(period: 'month' | 'year') {
  const preference = preferences[period];
  const value = useSyncExternalStore(
    preference.subscribe,
    preference.snapshot,
    () => true,
  );
  return [value, preference.set] as const;
}

export function useMonthRangePreference() {
  return useHistoricalRangePreference('month');
}
