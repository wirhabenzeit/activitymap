import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { type AdminTab, tabStates } from '~/lib/admin/health';
import { cn } from '~/lib/utils';
import type { AdminSnapshot } from '~/server/admin/contract';

import { AutoRefresh } from './auto-refresh';
import { Mark } from './parts';

export const adminMetadata: Metadata = {
  title: 'Admin · ActivityMap',
  robots: { index: false, follow: false, nocache: true },
};

const TABS: { tab: 'overview' | AdminTab; label: string; href: string }[] = [
  { tab: 'overview', label: 'Overview', href: '/admin' },
  { tab: 'users', label: 'Users', href: '/admin/users' },
  { tab: 'activities', label: 'Activities', href: '/admin/activities' },
  { tab: 'places', label: 'Places', href: '/admin/places' },
  { tab: 'system', label: 'System', href: '/admin/system' },
];

/** The dashboard's frame and tabs. Part of every page, not of a layout: a
 * layout is not rendered again on navigation, so the marks would be old, and
 * it would also wrap the 404 that everyone but an admin gets. */
export function AdminShell({
  snapshot,
  tab: current,
  children,
}: {
  snapshot: AdminSnapshot;
  tab: 'overview' | AdminTab;
  children: ReactNode;
}) {
  const states = tabStates(snapshot);
  return (
    <main className="mx-auto max-w-3xl bg-background px-3 pt-[max(1rem,env(safe-area-inset-top))] pb-8 text-foreground sm:px-6 sm:pt-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="flex gap-3 text-xs text-muted-foreground">
          <span>
            Updated {new Date(snapshot.observedAt).toISOString().slice(11, 19)}{' '}
            UTC
          </span>
          <Link href="/map" className="underline underline-offset-4">
            Back to the map
          </Link>
        </p>
      </header>
      <nav
        aria-label="Admin"
        className="relative mt-4 mb-6 flex gap-x-3 overflow-x-auto border-b text-sm sm:gap-x-5"
      >
        {TABS.map(({ tab, label, href }) => {
          const tone = tab === 'overview' ? 'ok' : states[tab].tone;
          const problem = tone === 'bad' || tone === 'warn';
          return (
            <Link
              key={tab}
              href={href}
              prefetch={false}
              aria-current={tab === current ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 border-b-2 border-transparent pb-2 whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                tab === current &&
                  'border-foreground font-semibold text-foreground',
              )}
            >
              {label}
              {problem && (
                <>
                  <Mark tone={tone} />
                  <span className="sr-only">has problems</span>
                </>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-7">{children}</div>
      <AutoRefresh />
    </main>
  );
}
