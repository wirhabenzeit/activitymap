'use client';

import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
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
      <h2 id="display-settings-title" className="text-sm font-semibold">
        Display
      </h2>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <Label
          htmlFor="settings-appearance"
          className="font-normal text-muted-foreground"
        >
          Appearance
        </Label>
        <Select
          value={mounted ? (theme ?? 'system') : 'system'}
          onValueChange={setTheme}
        >
          <SelectTrigger id="settings-appearance" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[80]">
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
        <Label
          htmlFor="settings-units"
          className="font-normal text-muted-foreground"
        >
          Units
        </Label>
        <Select
          value={units}
          onValueChange={(value) =>
            setDisplayUnits(value === 'imperial' ? 'imperial' : 'metric')
          }
        >
          <SelectTrigger id="settings-units" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[80]">
            <SelectItem value="metric">Metric</SelectItem>
            <SelectItem value="imperial">Imperial</SelectItem>
          </SelectContent>
        </Select>
        <Label
          htmlFor="settings-date-format"
          className="font-normal text-muted-foreground"
        >
          Date format
        </Label>
        <Select
          value={dateFormat}
          onValueChange={(value) => setDateFormat(value as DateFormat)}
        >
          <SelectTrigger id="settings-date-format" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[80]">
            {dateFormatOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
