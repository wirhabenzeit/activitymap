import { headers } from 'next/headers';

import { FirstSummaryFetch } from '~/components/auth/first-summary-fetch';
import {
  SignedOutConnectPanel,
  StravaConnectProvider,
} from '~/components/auth/strava-connect';
import { AppHeader } from '~/components/layout/app-header';
import { AppSidebar } from '~/components/layout/app-sidebar';
import { AuthProvider } from '~/components/providers/auth';
import { OfflineSyncProvider } from '~/components/providers/offline-sync';
import { ServiceWorkerProvider } from '~/components/providers/service-worker';
import { ToastManager } from '~/components/providers/toast';
import { SidebarProvider } from '~/components/ui/sidebar';
import { Toaster } from '~/components/ui/toaster';
import { BrowsingProvider } from '~/hooks/use-browsing-library';
import { auth } from '~/lib/auth';
import { QueryProvider } from '~/providers/query-provider';
import { localPlacesEnabled } from '~/server/config/local-places';
import { toCurrentUserDTO } from '~/server/db/dto';
import { getAccountInternal, getUserInternal } from '~/server/db/internal';
import { createAccountsRepository } from '~/server/repositories/accounts';
import type { InitialAuth } from '~/store/auth';

/**
 * The authenticated web app's shell (sidebar, header, its own Share button,
 * React Query, session lookup, offline sync, toasts). Everything under this
 * route group (`map`, `list`, `stats`, the `/` redirect) gets this shell;
 * `/share/[token]` deliberately lives outside this group so a share
 * recipient never sees the authenticated app's chrome around what must be a
 * standalone capability page (issue #132) - see `~/app/layout.tsx`'s doc
 * comment for the full rationale.
 */
export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const initialAuth: InitialAuth = {
    currentUser: null,
  };

  // If we have a session, resolve a safe, client-visible user summary.
  // Never pass the raw Account record (Strava tokens) or the Better Auth
  // session (which carries a reusable session token) to the client - see
  // issue #116.
  if (session?.user?.id) {
    const user = await getUserInternal(session.user.id);
    // The local places experiment renders stored data without refreshing Strava.
    // Keep the deployed credential lifecycle unchanged.
    const storedAccount = localPlacesEnabled()
      ? await createAccountsRepository().findStravaAccount({
          userId: user.id,
          accountId: String(user.athlete_id),
        })
      : await getAccountInternal({ userId: user.id });
    const account =
      storedAccount?.revokedAt || storedAccount?.scheduledErasureAt
        ? null
        : storedAccount;
    initialAuth.currentUser = user ? toCurrentUserDTO(user, account) : null;
  }

  return (
    <div style={{ width: '100dvw', height: '100dvh', overflow: 'hidden' }}>
      <ServiceWorkerProvider />
      <QueryProvider>
        {/* Reads the React Query client, so it must sit inside QueryProvider. */}
        <OfflineSyncProvider />
        <AuthProvider initialAuth={initialAuth}>
          <BrowsingProvider>
            <StravaConnectProvider>
              <SidebarProvider
                className="flex h-dvh flex-col"
                style={{ height: '100dvh' }}
              >
                <AppHeader />
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <AppSidebar />
                  <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <div className="h-14 w-full" />
                    <div className="min-h-0 w-full flex-1 overflow-hidden">
                      {children}
                      <SignedOutConnectPanel />
                      <FirstSummaryFetch />
                    </div>
                  </main>
                </div>
              </SidebarProvider>
            </StravaConnectProvider>
          </BrowsingProvider>
          <Toaster />
          <ToastManager />
        </AuthProvider>
      </QueryProvider>
    </div>
  );
}
