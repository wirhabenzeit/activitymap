'use client';

import { type ReactNode } from 'react';

import { type Sport } from '~/lib/stats/tile-data';
import { cn } from '~/lib/utils';
import { categorySettings } from '~/settings/category';

// One row style for every activity a Stats tile lists: sport symbol, name,
// a muted summary line and an optional detail line, linked when it can be
// opened.
export function ActivityRow({
  activityId,
  sport,
  name,
  summary,
  detail,
  onOpen,
  selected = false,
}: {
  activityId?: number;
  sport: Sport;
  name: string | null | undefined;
  summary: ReactNode;
  detail?: ReactNode;
  onOpen?: () => void;
  selected?: boolean;
}) {
  const { icon: SportIcon, color, name: sportName } = categorySettings[sport];
  const content = (
    <span className="flex min-w-0 items-start gap-2">
      <SportIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0"
        color={color}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words">
          {name?.trim() ? name : sportName}
        </span>
        <span className="block text-xs text-muted-foreground">{summary}</span>
        {detail && (
          <span className="mt-1 block text-xs tabular-nums">{detail}</span>
        )}
      </span>
      {onOpen && (
        <span aria-hidden="true" className="text-muted-foreground">
          ›
        </span>
      )}
    </span>
  );
  return onOpen ? (
    <button
      data-stats-activity-id={activityId}
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'min-h-11 w-full rounded px-1 py-3 text-left text-sm focus-visible:outline-2',
        selected
          ? 'bg-header-background/10 ring-1 ring-header-background/40 ring-inset hover:bg-header-background/15'
          : 'hover:bg-muted/40',
      )}
      onClick={onOpen}
    >
      {content}
    </button>
  ) : (
    <div className="py-3 text-sm">{content}</div>
  );
}
