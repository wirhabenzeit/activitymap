'use client';

import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import {
  useDisplayUnits,
  setDisplayUnits,
  useDateFormat,
  setDateFormat,
} from '~/hooks/use-display-preferences';
import { dateFormatOptions, type DateFormat } from '~/lib/date-preferences';
const subscribe = () => () => undefined;

export function DisplaySettings() {
  const { theme, setTheme } = useTheme();
  const units = useDisplayUnits();
  const dateFormat = useDateFormat();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <section className="space-y-3" aria-labelledby="display-settings-title">
      <h2 id="display-settings-title" className="font-semibold">
        Display
      </h2>
      <label className="flex flex-wrap items-center justify-between gap-4">
        Appearance
        <select
          className="min-w-0 max-w-full rounded-md border bg-background p-2"
          value={mounted ? (theme ?? 'system') : 'system'}
          onChange={(e) => setTheme(e.target.value)}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="flex flex-wrap items-center justify-between gap-4">
        Units
        <select
          className="min-w-0 max-w-full rounded-md border bg-background p-2"
          value={units}
          onChange={(e) =>
            setDisplayUnits(
              e.target.value === 'imperial' ? 'imperial' : 'metric',
            )
          }
        >
          <option value="metric">Metric</option>
          <option value="imperial">Imperial</option>
        </select>
      </label>
      <label className="flex flex-wrap items-center justify-between gap-4">
        Date format
        <select
          className="min-w-0 max-w-full rounded-md border bg-background p-2"
          value={dateFormat}
          onChange={(e) => setDateFormat(e.target.value as DateFormat)}
        >
          {dateFormatOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        Distance, elevation and speed use{' '}
        {units === 'metric'
          ? 'kilometres, metres and km/h'
          : 'miles, feet and mph'}
        . Preferences are saved on this browser.
      </p>
    </section>
  );
}
