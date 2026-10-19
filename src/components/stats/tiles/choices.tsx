'use client';
import type { ReactNode } from 'react';

import { cn } from '~/lib/utils';

export function StatsChoices<Option extends string>({
  label,
  options,
  value,
  onChange,
  visibleLabel,
  accessibleLabel,
  compact = false,
}: {
  label: string;
  options: readonly Option[];
  value: Option | undefined;
  onChange: (value: Option) => void;
  visibleLabel: (value: Option) => ReactNode;
  accessibleLabel: (value: Option) => string;
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 rounded-md bg-muted p-0.5',
        compact && '-my-1 self-center',
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          aria-label={accessibleLabel(option)}
          title={accessibleLabel(option)}
          tabIndex={option === (value ?? options[0]) ? 0 : -1}
          onClick={() => onChange(option)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.stopPropagation();
              return;
            }
            const rtl =
              getComputedStyle(event.currentTarget).direction === 'rtl';
            const offset =
              event.key === 'ArrowRight'
                ? rtl
                  ? -1
                  : 1
                : event.key === 'ArrowLeft'
                  ? rtl
                    ? 1
                    : -1
                  : 0;
            const index = options.indexOf(option);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : offset
                    ? (index + offset + options.length) % options.length
                    : -1;
            if (next < 0) return;
            event.preventDefault();
            event.stopPropagation();
            onChange(options[next]!);
            (
              event.currentTarget.parentElement?.children[next] as
                HTMLButtonElement | undefined
            )?.focus();
          }}
          className={cn(
            'min-h-11 min-w-11 rounded-[5px] font-medium text-muted-foreground',
            compact ? 'px-1.5 text-[11px]' : 'px-3 text-xs',
            option === value && 'bg-background text-foreground shadow-xs',
          )}
        >
          {visibleLabel(option)}
        </button>
      ))}
    </div>
  );
}
