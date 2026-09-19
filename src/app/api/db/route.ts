import { auth } from '~/lib/auth';
import { db } from '~/server/db';
import { stringify } from 'csv-stringify/sync';
import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  // Authenticate via the secure session cookie or an `Authorization: Bearer`
  // header only. No credential is ever accepted in the URL.
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id)
    return new Response('Not authenticated', {
      status: 401,
    });
  const userID = session.user.id;

  const account = await db.query.accounts.findFirst({
    where: (accounts, { eq }) => eq(accounts.userId, userID),
  });
  if (!account) return new Response('Account not found', { status: 404 });
  const activities = await db.query.activities.findMany({
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
