'use client';

import { useSyncExternalStore } from 'react';
import { type DateFormat, dateFormatOptions } from '~/lib/date-preferences';
import { type UnitSystem } from '~/lib/units';

const key = 'activitymap.units';
const event = 'activitymap-units-change';
let volatileValue: UnitSystem | undefined;
function snapshot(): UnitSystem {
  if (volatileValue) return volatileValue;
  try {
    return localStorage.getItem(key) === 'imperial' ? 'imperial' : 'metric';
  } catch {
    return volatileValue ?? 'metric';
  }
}
function subscribe(listener: () => void) {
  const storageChanged = () => {
    volatileValue = undefined;
    listener();
  };
  window.addEventListener('storage', storageChanged);
  window.addEventListener(event, listener);
  return () => {
    window.removeEventListener('storage', storageChanged);
    window.removeEventListener(event, listener);
  };
}
export function setDisplayUnits(units: UnitSystem) {
  volatileValue = units;
  try {
    localStorage.setItem(key, units);
    volatileValue = undefined;
  } catch {
    /* Still usable for this session when storage is unavailable. */
  }
  window.dispatchEvent(new Event(event));
}
export function useDisplayUnits(): UnitSystem {
  return useSyncExternalStore(subscribe, snapshot, () => 'metric');
}

const dateKey = 'activitymap.date-format';
let volatileDate: DateFormat | undefined;
function dateSnapshot(): DateFormat {
  if (volatileDate) return volatileDate;
  try {
    const value = localStorage.getItem(dateKey);
    return (
      dateFormatOptions.find((option) => option.value === value)?.value ??
      'system'
    );
  } catch {
    return 'system';
  }
}
function subscribeDate(listener: () => void) {
  const changed = () => {
    volatileDate = undefined;
    listener();
  };
  window.addEventListener('storage', changed);
  window.addEventListener(event, listener);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener(event, listener);
  };
}
export function setDateFormat(format: DateFormat) {
  volatileDate = format;
  try {
    localStorage.setItem(dateKey, format);
    volatileDate = undefined;
  } catch {
    /* Use the preference for this session. */
  }
  window.dispatchEvent(new Event(event));
}
export function useDateFormat(): DateFormat {
  return useSyncExternalStore(subscribeDate, dateSnapshot, () => 'system');
}
