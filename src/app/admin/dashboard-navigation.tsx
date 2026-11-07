'use client';

import { ArrowUpRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useRef, useTransition } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { cn } from '~/lib/utils';

const views = {
  overview: 'Overview',
  jobs: 'Jobs',
  failures: 'Failures',
  places: 'Places',
  ingestion: 'Ingestion',
  webhooks: 'Webhooks',
  budget: 'Budget',
} as const;

type View = keyof typeof views;
const viewKeys = Object.keys(views) as View[];

export type StatusCard = {
  view: Exclude<View, 'overview'>;
  title: string;
  value: string;
  detail: string;
  tone?: 'good' | 'warn' | 'bad';
};

const toneStyles = {
  good: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-300',
  bad: 'text-red-700 dark:text-red-300',
};

export function DashboardNavigation({
  observed,
  cards,
  panels,
}: {
  observed: string;
  cards: StatusCard[];
  panels: Record<Exclude<View, 'overview'>, ReactNode>;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const tabRefs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});
  const onlyFailures = searchParams.get('failures') === '1';
  const view =
    viewKeys.find((key) => key === searchParams.get('view')) ??
    (onlyFailures ? 'jobs' : 'overview');

  function viewHref(next: View) {
    const params = new URLSearchParams();
    if (next !== 'overview' || onlyFailures) params.set('view', next);
    if (onlyFailures) params.set('failures', '1');
    const query = params.toString();
    return query ? `/admin?${query}` : '/admin';
  }

  function selectView(next: View) {
    if (next === view) return;
    window.history.pushState(null, '', viewHref(next));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  return (
    <Tabs
      value={view}
      onValueChange={(next) => selectView(next as View)}
      activationMode="manual"
    >
      <header className="mb-4 flex items-center justify-between gap-2 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            ActivityMap admin
          </h1>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Snapshot {observed}
          </p>
        </div>
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-60 sm:gap-2 sm:px-3 sm:text-sm"
        >
          <RefreshCw
            aria-hidden="true"
            className={cn('size-4', refreshing && 'motion-safe:animate-spin')}
          />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <TabsList
        aria-label="Admin views"
        className="sticky top-[env(safe-area-inset-top)] z-10 mb-4 grid h-auto w-full grid-cols-4 gap-1 sm:grid-cols-7"
      >
        {viewKeys.map((key) => (
          <TabsTrigger
            key={key}
            value={key}
            ref={(node) => {
              tabRefs.current[key] = node;
            }}
            className={cn(
              'min-h-11 px-1 text-xs data-[state=active]:font-semibold sm:text-sm',
              key === 'overview' && 'col-span-2 sm:col-span-1',
            )}
          >
            {views[key]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview" className="mt-0 space-y-3">
        <h2 className="text-lg font-semibold">At a glance</h2>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
          {cards.map(({ view: destination, title, value, detail, tone }) => (
            <Link
              key={title}
              href={viewHref(destination)}
              prefetch={false}
              onNavigate={(event) => {
                event.preventDefault();
                selectView(destination);
                tabRefs.current[destination]?.focus({ preventScroll: true });
              }}
              className="group min-w-0 rounded-xl border bg-card p-3 hover:bg-muted/50 sm:p-4"
            >
              <div className="flex items-start justify-between gap-1 text-xs font-medium text-muted-foreground sm:text-sm">
                {title}
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-4 shrink-0 group-hover:text-foreground"
                />
              </div>
              <p
                className={cn(
                  'mt-1 text-sm leading-snug font-semibold tracking-tight tabular-nums sm:text-lg',
                  tone && toneStyles[tone],
                )}
              >
                {value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
            </Link>
          ))}
        </div>
      </TabsContent>

      {viewKeys.map(
        (key) =>
          key !== 'overview' && (
            <TabsContent key={key} value={key} className="mt-0 space-y-6">
              {panels[key]}
            </TabsContent>
          ),
      )}
    </Tabs>
  );
}
