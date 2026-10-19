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
  setDateFormat,
  setDisplayUnits,
  useDateFormat,
  useDisplayUnits,
} from '~/hooks/use-display-preferences';
import { type DateFormat, dateFormatOptions } from '~/lib/date-preferences';
import { message } from '~/lib/presentation/messages';

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
        {message('settings.display')}
      </h2>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <Label
          htmlFor="settings-appearance"
          className="font-normal text-muted-foreground"
        >
          {message('display.appearance')}
        </Label>
        <Select
          value={mounted ? (theme ?? 'system') : 'system'}
          onValueChange={setTheme}
        >
          <SelectTrigger id="settings-appearance" className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">{message('display.system')}</SelectItem>
            <SelectItem value="light">{message('display.light')}</SelectItem>
            <SelectItem value="dark">{message('display.dark')}</SelectItem>
          </SelectContent>
        </Select>
        <Label
          htmlFor="settings-units"
          className="font-normal text-muted-foreground"
        >
          {message('display.units')}
        </Label>
        <Select
          value={units}
          onValueChange={(value) =>
            setDisplayUnits(value === 'imperial' ? 'imperial' : 'metric')
          }
        >
          <SelectTrigger id="settings-units" className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="metric">{message('display.metric')}</SelectItem>
            <SelectItem value="imperial">
              {message('display.imperial')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Label
          htmlFor="settings-date-format"
          className="font-normal text-muted-foreground"
        >
          {message('display.dateFormat')}
        </Label>
        <Select
          value={dateFormat}
          onValueChange={(value) => setDateFormat(value as DateFormat)}
        >
          <SelectTrigger id="settings-date-format" className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dateFormatOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {message(
                  (
                    {
                      system: 'display.system',
                      'day-first': 'display.dayFirst',
                      'month-first': 'display.monthFirst',
                      iso: 'display.iso',
                    } as const
                  )[option.value],
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
