'use client';

import { type ReactNode } from 'react';

import { categorySettings } from '~/settings/category';
import { type Sport } from '~/lib/stats/tile-data';

// One row style for every activity a Stats tile lists: sport mark, name,
// a muted summary line and an optional detail line, linked when it can be
// opened.
export function ActivityRow({
  sport,
  name,
  summary,
  detail,
  onOpen,
}: {
  sport: Sport;
  name: string | null | undefined;
  summary: ReactNode;
  detail?: ReactNode;
  onOpen?: () => void;
}) {
  const content = (
    <span className="flex min-w-0 items-start gap-2">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: categorySettings[sport].color }}
      />
      <span className="min-w-0 flex-1">
        <span className="block break-words font-medium">
          {name?.trim() ? name : categorySettings[sport].name}
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
      type="button"
      className="min-h-11 w-full py-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-2"
      onClick={onOpen}
    >
      {content}
    </button>
  ) : (
    <div className="py-3 text-sm">{content}</div>
  );
}
