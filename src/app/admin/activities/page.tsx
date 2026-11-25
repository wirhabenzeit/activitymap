import { AdminShell, adminMetadata } from '~/components/admin/shell';
import { ActivitiesView } from '~/components/admin/views';
import { loadAdminSnapshot } from '~/server/admin/snapshot';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata;

export default async function AdminActivitiesPage() {
  const snapshot = await loadAdminSnapshot();
  return (
    <AdminShell snapshot={snapshot} tab="activities">
      <ActivitiesView snapshot={snapshot} />
    </AdminShell>
  );
}
