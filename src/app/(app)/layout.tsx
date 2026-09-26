import { AuthProvider } from '~/components/providers/auth';
import { auth } from '~/lib/auth';
import { headers } from 'next/headers';
import { SidebarProvider } from '~/components/ui/sidebar';
import { AppSidebar } from '~/components/layout/app-sidebar';
import { AppHeader } from '~/components/layout/app-header';
import { getUserInternal, getAccountInternal } from '~/server/db/internal';
import { toCurrentUserDTO } from '~/server/db/dto';
import type { InitialAuth } from '~/store/auth';
import { Toaster } from '~/components/ui/toaster';
import { ToastManager } from '~/components/providers/toast';
import { QueryProvider } from '~/providers/query-provider';
import { ServiceWorkerProvider } from '~/components/providers/service-worker';
import { OfflineSyncProvider } from '~/components/providers/offline-sync';

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
    const account = user ? await getAccountInternal({ userId: user.id }) : null;
    initialAuth.currentUser = user ? toCurrentUserDTO(user, account) : null;
  }

  return (
    <div style={{ width: '100dvw', height: '100dvh', overflow: 'hidden' }}>
      <ServiceWorkerProvider />
      <QueryProvider>
        {/* Reads the React Query client, so it must sit inside QueryProvider. */}
        <OfflineSyncProvider />
        <AuthProvider initialAuth={initialAuth}>
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
                </div>
              </main>
            </div>
          </SidebarProvider>
          <Toaster />
          <ToastManager />
        </AuthProvider>
      </QueryProvider>
    </div>
  );
}
