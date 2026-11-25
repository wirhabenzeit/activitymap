import { AdminShell, adminMetadata } from '~/components/admin/shell';
import { OverviewView } from '~/components/admin/views';
import { loadAdminSnapshot } from '~/server/admin/snapshot';

/**
 * The operator dashboard (docs/admin-dashboard-plan.md), for the athletes in
 * `ACTIVITYMAP_ADMIN_ATHLETE_IDS`; everyone else gets a 404. Each of its pages
 * checks that itself, through `loadAdminSnapshot`.
 */
export const dynamic = 'force-dynamic';
export const metadata = adminMetadata;

export default async function AdminOverviewPage() {
  const snapshot = await loadAdminSnapshot();
  return (
    <AdminShell snapshot={snapshot} tab="overview">
      <OverviewView snapshot={snapshot} />
    </AdminShell>
  );
}
