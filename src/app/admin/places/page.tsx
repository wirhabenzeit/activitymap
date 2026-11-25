import { AdminShell, adminMetadata } from '~/components/admin/shell';
import { PlacesView } from '~/components/admin/views';
import { loadAdminSnapshot } from '~/server/admin/snapshot';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata;

export default async function AdminPlacesPage() {
  const snapshot = await loadAdminSnapshot();
  return (
    <AdminShell snapshot={snapshot} tab="places">
      <PlacesView snapshot={snapshot} />
    </AdminShell>
  );
}
