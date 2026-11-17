'use client';

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';
import type { Sport } from '~/lib/stats/tile-data';
import { categorySettings } from '~/settings/category';

import type { TileContext } from './tiles';

export function ExplorerHeader({
  context,
  title,
}: {
  context: TileContext;
  title: string;
}) {
  return (
    <header className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        {context.focusControls?.back}
        <h1 className="text-base font-medium">{title}</h1>
      </div>
      {context.focusControls?.metric}
    </header>
  );
}

export function ExplorerData({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-4 border-t pt-2" data-explorer-data>
      <summary className="w-fit cursor-pointer rounded px-1 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <span className="group-open:hidden">Show data</span>
        <span className="hidden group-open:inline">Hide data</span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

export function HistoricalRangeControl({
  checked,
  onChange,
  explanation,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  explanation: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-muted-foreground">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="size-4 accent-current"
        />
        Historical range
      </label>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About historical range"
              className="flex size-8 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-w-80 text-sm leading-relaxed"
          >
            {explanation}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function ExplorerSportLegend({ sports }: { sports: Sport[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
      {sports.map((sport) => (
        <span key={sport} className="flex items-center gap-1.5">
          <i
            className="size-2 rounded-full"
            style={{ background: categorySettings[sport].color }}
          />
          {categorySettings[sport].name}
        </span>
      ))}
    </div>
  );
}
