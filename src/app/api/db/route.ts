import { stringify } from 'csv-stringify/sync';
import { type NextRequest } from 'next/server';

import { auth } from '~/lib/auth';
import { libraryFromConvex } from '~/server/application/library-export';
import { resolveActor } from '~/server/auth/actor';
import { resolveRequestSession } from '~/server/auth/request-session';
import { db } from '~/server/db';
import { convexReadOwnerFor } from '~/server/preview/convex';
import { previewSelection } from '~/server/preview/selection';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Authenticate via the secure session cookie or an `Authorization: Bearer`
  // header only. No credential is ever accepted in the URL.
  const session = await resolveRequestSession(request, ({ headers }) =>
    auth.api.getSession({ headers }),
  );
  if (!session?.user?.id)
    return new Response('Not authenticated', {
      status: 401,
    });
  if (previewSelection({ userId: session.user.id }))
    return new Response('CSV export is unavailable in the fixture preview', {
      status: 503,
    });
  const userID = session.user.id;

  const account = await db.query.accounts.findFirst({
    where: (accounts, { eq }) => eq(accounts.userId, userID),
  });
  if (!account) return new Response('Account not found', { status: 404 });
  // Postgres holds the library only while it writes it.
  const actor = await resolveActor(request.headers);
  let activities;
  if (actor?.convexWrites) {
    const convex = convexReadOwnerFor(actor);
    if (!convex)
      return new Response('The library is unavailable', { status: 503 });
    activities = await libraryFromConvex(convex, actor);
  } else
    activities = await db.query.activities.findMany({
      where: (activities, { eq }) =>
        eq(activities.athlete, Number(account.providerAccountId)),
    });
  const csv = stringify(
    activities.map(
      ({
        id,
        distance,
        sport_type,
        elapsed_time,
        moving_time,
        name,
        description,
        elev_high,
        elev_low,
        total_elevation_gain,
        start_date_local,
        start_latlng,
        average_speed,
        weighted_average_watts,
      }) => ({
        id,
        distance,
        sport_type,
        elapsed_time,
        moving_time,
        name,
        description,
        elev_high,
        elev_low,
        total_elevation_gain,
        start_date_local,
        start_latlng,
        average_speed,
        weighted_average_watts,
      }),
    ),
    { header: true },
  );
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv' },
  });
}
