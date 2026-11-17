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
        'inline-flex shrink-0 rounded-md p-0.5',
        compact
          ? 'relative -my-1 self-center before:pointer-events-none before:absolute before:inset-x-0 before:top-1/2 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-muted'
          : 'bg-muted',
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
            'relative rounded-[5px] font-medium text-muted-foreground',
            // Keep the visible face compact independently of the touch target.
            compact
              ? 'flex min-h-7 min-w-7 items-center p-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11'
              : 'min-h-11 min-w-11 px-3 text-xs',
            option === value && 'text-foreground',
            !compact && option === value && 'bg-background shadow-xs',
          )}
        >
          {compact ? (
            <span
              data-stats-choice-face
              className={cn(
                'flex min-h-7 w-full items-center justify-center rounded-[5px] px-1.5 py-1 text-[11px] leading-none',
                option === value && 'bg-background shadow-xs',
              )}
            >
              {visibleLabel(option)}
            </span>
          ) : (
            visibleLabel(option)
          )}
        </button>
      ))}
    </div>
  );
}
