import { AdminShell, adminMetadata } from '~/components/admin/shell';
import { UsersView } from '~/components/admin/views';
import { loadAdminSnapshot } from '~/server/admin/snapshot';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata;

export default async function AdminUsersPage() {
  const snapshot = await loadAdminSnapshot();
  return (
    <AdminShell snapshot={snapshot} tab="users">
      <UsersView snapshot={snapshot} />
    </AdminShell>
  );
}
