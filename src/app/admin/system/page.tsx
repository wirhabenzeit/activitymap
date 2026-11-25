import { AdminShell, adminMetadata } from '~/components/admin/shell';
import { SystemView } from '~/components/admin/views';
import { loadAdminSnapshot } from '~/server/admin/snapshot';

import { WebhookControls } from '../webhook-controls';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata;

export default async function AdminSystemPage() {
  const snapshot = await loadAdminSnapshot();
  return (
    <AdminShell snapshot={snapshot} tab="system">
      <SystemView snapshot={snapshot} controls={<WebhookControls />} />
    </AdminShell>
  );
}
