'use client';

import { useState, useTransition } from 'react';

import {
  moveMyLibraryToConvex,
  moveMyLibraryToPostgres,
  myLibraryWriter,
} from '~/server/convex-mirror/actions';
import type { HandoffReport } from '~/server/convex-mirror/handoff';

const button =
  'rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50';

const describe = (report: HandoffReport) =>
  [
    report.outcome === 'moved'
      ? `Done. ${report.writer} now writes your library.`
      : report.outcome === 'already'
        ? `Nothing to do: ${report.writer} already writes your library.`
        : `Stopped: ${report.reason}. ${report.writer} writes your library.`,
    ...report.steps,
  ].join('\n');

/**
 * Operator controls for which store writes the signed-in admin's own
 * library. The server actions call `requireAdmin()` themselves; this page
 * being admin-only is not the control.
 */
export function WriterControls() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const run = (action: () => Promise<string>, confirmation?: string) => {
    if (confirmation && !window.confirm(confirmation)) return;
    startTransition(async () => {
      try {
        setResult(await action());
      } catch (error) {
        setResult(error instanceof Error ? error.message : 'Request failed');
      }
    });
  };

  return (
    <div className="space-y-2 px-3 py-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={() =>
            run(async () => `${await myLibraryWriter()} writes your library.`)
          }
        >
          Check writer
        </button>
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={() =>
            run(
              async () => describe(await moveMyLibraryToConvex()),
              'Move your library to Convex? New activities, edits and refreshes will be written there, and Postgres stops updating your library.',
            )
          }
        >
          Move to Convex
        </button>
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={() =>
            run(
              async () => describe(await moveMyLibraryToPostgres()),
              'Move your library back to Postgres? It fetches from Strava what changed in the meantime, which can take hours.',
            )
          }
        >
          Move back to Postgres
        </button>
      </div>
      <p role="status" className="whitespace-pre-line text-muted-foreground">
        {pending ? 'Working…' : result}
      </p>
    </div>
  );
}
