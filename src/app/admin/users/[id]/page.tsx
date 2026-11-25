import { notFound } from 'next/navigation';

import { AdminShell, adminMetadata } from '~/components/admin/shell';
import { UserView } from '~/components/admin/views';
import { loadAdminSnapshot } from '~/server/admin/snapshot';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata;

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, snapshot] = await Promise.all([params, loadAdminSnapshot()]);
  const user = snapshot.users.find(({ athleteId }) => athleteId === id);
  if (!user) notFound();
  return (
    <AdminShell snapshot={snapshot} tab="users">
      <UserView snapshot={snapshot} user={user} />
    </AdminShell>
  );
}
