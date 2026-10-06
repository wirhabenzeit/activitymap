import 'server-only';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { auth } from '~/lib/auth';
import { isAdminAthlete } from '~/server/config/admin';
import { db } from '~/server/db';
import { users } from '~/server/db/schema';

/**
 * Resolves the signed-in admin for the admin dashboard, or renders the
 * ordinary 404 for anyone else (signed out, or not listed in
 * `ACTIVITYMAP_ADMIN_ATHLETE_IDS`), so the page's existence isn't revealed.
 * Enforced on the server for every request.
 */
export async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) notFound();
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, name: true, athlete_id: true },
  });
  if (!user || !isAdminAthlete(user.athlete_id)) notFound();
  return user;
}
