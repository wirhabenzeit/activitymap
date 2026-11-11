import { stringify } from 'csv-stringify/sync';
import { type NextRequest } from 'next/server';

import { auth } from '~/lib/auth';
import { libraryFromConvex } from '~/server/application/library-export';
import { resolveActor } from '~/server/auth/actor';
import { resolveRequestSession } from '~/server/auth/request-session';
import { findStravaAccountInternal } from '~/server/auth/users';
import { libraryFor } from '~/server/library';

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
  const userID = session.user.id;

  const account = await findStravaAccountInternal({ userId: userID });
  if (!account) return new Response('Account not found', { status: 404 });
  // Postgres holds the library only while it writes it.
  const actor = await resolveActor(request.headers);
  const library = await libraryFor(actor);
  if (!library || !actor)
    return new Response('The library is unavailable', { status: 503 });
  const activities = await libraryFromConvex(library, actor);
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
