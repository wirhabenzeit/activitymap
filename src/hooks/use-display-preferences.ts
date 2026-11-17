'use client';

import { useSyncExternalStore } from 'react';

import { type DateFormat, dateFormatOptions } from '~/lib/date-preferences';
import { formattingLocale } from '~/lib/presentation/messages';
import { type UnitSystem } from '~/lib/units';

/**
 * One set of window listeners per preference, however many components read
 * it. Every list row reads these preferences, so per-subscriber listeners
 * meant hundreds of add/removeEventListener calls whenever the list was shown.
 */
function sharedWindowSubscription(
  events: string[],
  // Drops cached values; called for each event and when nothing listens
  // (another tab may change storage unobserved), with no event then.
  reset: (event?: Event) => void,
) {
  const listeners = new Set<() => void>();
  const fire = (event: Event) => {
    reset(event);
    for (const listener of listeners) listener();
  };
  return (listener: () => void) => {
    if (!listeners.size)
      for (const name of events) window.addEventListener(name, fire);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size) return;
      for (const name of events) window.removeEventListener(name, fire);
      reset();
    };
  };
}

const subscribeLocale = sharedWindowSubscription(
  ['languagechange'],
  // The locale snapshot reads navigator.language directly; nothing to drop.
  () => undefined,
);
export function useFormattingLocale(): string {
  return useSyncExternalStore(
    subscribeLocale,
    () => formattingLocale(navigator.language),
    () => 'en',
  );
}

const key = 'activitymap.units';
const event = 'activitymap-units-change';
// Set when storage is unavailable: the preference then lives for this session.
let volatileValue: UnitSystem | undefined;
// The stored value, read once per change instead of once per reader render.
let storedUnits: UnitSystem | undefined;
function snapshot(): UnitSystem {
  if (volatileValue) return volatileValue;
  if (storedUnits) return storedUnits;
  try {
    storedUnits =
      localStorage.getItem(key) === 'imperial' ? 'imperial' : 'metric';
    return storedUnits;
  } catch {
    return volatileValue ?? 'metric';
  }
}
const subscribe = sharedWindowSubscription(['storage', event], (change) => {
  storedUnits = undefined;
  if (change?.type === 'storage') volatileValue = undefined;
});
export function setDisplayUnits(units: UnitSystem) {
  volatileValue = units;
  try {
    localStorage.setItem(key, units);
    volatileValue = undefined;
  } catch {
    /* Still usable for this session when storage is unavailable. */
  }
  storedUnits = undefined;
  window.dispatchEvent(new Event(event));
}
export function useDisplayUnits(): UnitSystem {
  return useSyncExternalStore(subscribe, snapshot, () => 'metric');
}

const dateKey = 'activitymap.date-format';
let volatileDate: DateFormat | undefined;
let storedDate: DateFormat | undefined;
function dateSnapshot(): DateFormat {
  if (volatileDate) return volatileDate;
  if (storedDate) return storedDate;
  try {
    const value = localStorage.getItem(dateKey);
    storedDate =
      dateFormatOptions.find((option) => option.value === value)?.value ??
      'system';
    return storedDate;
  } catch {
    return 'system';
  }
}
const subscribeDate = sharedWindowSubscription(['storage', event], (change) => {
  storedDate = undefined;
  if (change?.type === 'storage') volatileDate = undefined;
});
export function setDateFormat(format: DateFormat) {
  volatileDate = format;
  try {
    localStorage.setItem(dateKey, format);
    volatileDate = undefined;
  } catch {
    /* Use the preference for this session. */
  }
  storedDate = undefined;
  window.dispatchEvent(new Event(event));
}
export function useDateFormat(): DateFormat {
  return useSyncExternalStore(subscribeDate, dateSnapshot, () => 'system');
}
