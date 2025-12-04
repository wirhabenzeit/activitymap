import { auth } from '~/lib/auth';
import { headers } from 'next/headers';
import { db } from '~/server/db';
import { stringify } from 'csv-stringify/sync';
import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  let userID: string | undefined;
  if (request.nextUrl.searchParams.has('session')) {
    const sessionToken = request.nextUrl.searchParams.get('session');
    console.log('looking for session', sessionToken);
    const session = await db.query.sessions.findFirst({
      where: (sessions, { eq }) => eq(sessions.sessionToken, sessionToken!),
    });
    if (!session)
      return new Response('Session not found', {
        status: 404,
      });
    userID = session?.userId;
    console.log('found session', session);
  } else {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user?.id)
      return new Response('Not authenticated', {
        status: 401,
      });
    userID = session.user.id!;
  }

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
