import 'server-only';

import { headers } from 'next/headers';

import { auth } from '~/lib/auth';
import { getAccountInternal, getUserInternal } from '~/server/db/internal';

/** Transport-only optional session lookup; raw credentials stay server-side. */
export async function getAuthenticatedAccountInternal() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id
    ? getAccountInternal({ userId: session.user.id })
    : null;
}

export async function getRequestUserInternal(id?: string) {
  const userId =
    id ?? (await auth.api.getSession({ headers: await headers() }))?.user?.id;
  if (!userId) throw new Error('Not authenticated');
  return getUserInternal(userId);
}
