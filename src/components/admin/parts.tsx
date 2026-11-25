import Link from 'next/link';
import type { ReactNode } from 'react';

import type { Tone } from '~/lib/admin/health';
import { cn } from '~/lib/utils';

/** Shape and colour both say the state, and text always stands beside it. */
const MARKS: Record<Tone, string> = {
  ok: 'rounded-full bg-emerald-600 dark:bg-emerald-400',
  run: 'rounded-full border-2 border-blue-600 dark:border-blue-400',
  warn: 'bg-amber-600 [clip-path:polygon(50%_0,100%_100%,0_100%)] dark:bg-amber-400',
  bad: 'rotate-45 scale-90 bg-red-600 dark:bg-red-400',
  off: 'rounded-full border border-muted-foreground',
};

export function Mark({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.25 shrink-0', MARKS[tone])}
    />
  );
}

export function State({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark tone={tone} />
      <span>{children}</span>
    </span>
  );
}

export function Section({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Box({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
      {children}
    </div>
  );
}

const rowClass =
  'flex items-baseline justify-between gap-x-5 gap-y-1 px-3.5 py-2.5';

/** One line of a box; with `href` the whole line is a link. */
export function Row({
  label,
  value,
  href,
}: {
  label: ReactNode;
  value?: ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      {value !== undefined && (
        <span className="text-right text-muted-foreground tabular-nums">
          {value}
        </span>
      )}
    </>
  );
  return href ? (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        rowClass,
        'hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {content}
    </Link>
  ) : (
    <div className={rowClass}>{content}</div>
  );
}

export function Figures({
  items,
}: {
  items: [value: string, label: string][];
}) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-4">
      {items.map(([value, label]) => (
        <div key={label} className="flex flex-col-reverse justify-end">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Meter({
  label,
  used,
  limit,
  note,
}: {
  label: string;
  used: number;
  limit: number;
  note?: string;
}) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <div className="space-y-2 px-3.5 py-3">
      <div className="flex justify-between gap-4">
        <span>{label}</span>
        <span className="text-right text-muted-foreground tabular-nums">
          {used.toLocaleString('en-US')} of {limit.toLocaleString('en-US')}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="h-2 overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className="h-full bg-blue-600 dark:bg-blue-500"
          style={{ width: `${share * 100}%` }}
        />
      </div>
      {note && <State tone="warn">{note}</State>}
    </div>
  );
}
