import 'server-only';

import { createHmac } from 'node:crypto';

import {
  type AdminOverview,
  type AdminUser,
  adminOverviewSchema,
  adminUsersPageSchema,
} from './contract';

/** Pages of users read for one snapshot (16 each). */
const MAX_PAGES = 64;

/**
 * Reads the operator dashboard's figures from the Convex backend's signed
 * admin route (`backend/convex/http.ts`). Callers authorize the viewer first
 * (`requireAdmin`): the route answers for every user.
 */
export async function readAdminFigures(
  fetcher: typeof fetch = fetch,
): Promise<AdminOverview & { users: AdminUser[] }> {
  const origin = process.env.ACTIVITYMAP_CONVEX_SITE;
  if (!origin) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  const url = new URL('/internal/admin/v1', origin);
  const version = process.env.ACTIVITYMAP_CONVEX_KEY_ID ?? '';
  const secret = process.env.ACTIVITYMAP_CONVEX_SIGNING_KEY ?? '';
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
    !/^[0-9a-f]{64}$/.test(secret)
  )
    throw new Error('Invalid Convex bridge configuration');

  async function read(operation: { kind: string; cursor?: string | null }) {
    const body = JSON.stringify({ operation });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(`activitymap-admin-v1\n${version}\n${timestamp}\n${body}`)
      .digest('hex');
    const response = await fetcher(url, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/json',
        'X-ActivityMap-Key-Id': version,
        'X-ActivityMap-Timestamp': timestamp,
        'X-ActivityMap-Signature': signature,
      },
      body,
    });
    if (!response.ok)
      throw new Error(`Convex admin read unavailable (${response.status})`);
    return (await response.json()) as unknown;
  }

  async function readUsers() {
    const users: AdminUser[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = adminUsersPageSchema.parse(
        await read({ kind: 'users', cursor }),
      );
      users.push(...result.page);
      cursor = result.cursor;
      if (cursor === null) return users;
    }
    throw new Error('Too many users for the admin dashboard');
  }

  const [overview, users] = await Promise.all([
    read({ kind: 'overview' }).then((value) =>
      adminOverviewSchema.parse(value),
    ),
    readUsers(),
  ]);
  return { ...overview, users };
}
