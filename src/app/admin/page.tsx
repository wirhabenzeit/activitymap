import type { Metadata } from 'next';
import Link from 'next/link';

import { requireAdmin } from '~/server/auth/admin';

import { WebhookControls } from './webhook-controls';

/**
 * Operator page. Reachable only by the athletes in `ADMIN_ATHLETE_IDS`
 * (`requireAdmin` answers 404 to everyone else).
 *
 * Ingestion, reconciliation and place matching run in the Convex backend
 * and are observed there (its dashboard shows the jobs, their failures and
 * the logs). What the app itself controls is the Strava push subscription.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin · ActivityMap',
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPage() {
  await requireAdmin();
  return (
    <main className="mx-auto max-w-3xl space-y-8 bg-background px-3 pt-[max(1rem,env(safe-area-inset-top))] pb-8 text-foreground sm:px-6 sm:pt-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <Link href="/map" className="text-sm underline underline-offset-4">
          Back to the map
        </Link>
      </header>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Strava push subscription</h2>
          <p className="text-sm text-muted-foreground">
            Strava reports new, changed and deleted activities to this
            deployment&apos;s callback. Without a subscription, changes arrive
            only with the periodic reconciliation.
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <WebhookControls />
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Ingestion</h2>
        <p className="text-sm text-muted-foreground">
          Activities, recordings, photos and place matches are fetched and
          stored by the Convex backend. Its dashboard shows the jobs in
          progress, failures and logs.
        </p>
      </section>
    </main>
  );
}
