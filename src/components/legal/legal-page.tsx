import Link from 'next/link';
import type { ReactNode } from 'react';

import { LEGAL_LAST_UPDATED, LEGAL_PATHS, MARKETING_PATH } from '~/lib/legal';

const NAVIGATION = [
  { href: MARKETING_PATH, label: 'About' },
  { href: LEGAL_PATHS.privacy, label: 'Privacy policy' },
  { href: LEGAL_PATHS.terms, label: 'Terms of use' },
  { href: LEGAL_PATHS.support, label: 'Support' },
] as const;

/**
 * Standalone reading layout for the public legal pages. They sit outside the
 * authenticated `(app)` shell, so a reviewer, a search engine or someone
 * without an account sees plain, scrollable text. The root layout locks the
 * viewport to the app, so this page owns its own scrolling.
 */
export function LegalPage({
  title,
  updated = true,
  children,
}: {
  title: string;
  updated?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <header className="border-b bg-[#1976d2] text-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Link href="/map" className="font-semibold">
            ActivityMap
          </Link>
          <nav
            aria-label="Legal"
            className="flex gap-x-4 text-sm whitespace-nowrap"
          >
            {NAVIGATION.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="underline-offset-4 hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-base leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {updated && (
          <p className="text-sm text-muted-foreground">
            Last updated: {LEGAL_LAST_UPDATED}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
