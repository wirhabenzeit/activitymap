import type {Session} from "next-auth";
import {auth} from "~/auth";
import {db} from "~/server/db";
import {Activity} from "~/server/db/schema";
import {stringify} from "csv-stringify/sync";

export async function GET() {
  const session: Session | null = await auth();
  if (!session?.user?.id)
    return new Response("Not authenticated", {status: 401});
  const account = await db.query.accounts.findFirst({
    where: (accounts, {eq}) =>
      eq(accounts.userId, session.user!.id!),
  });
  if (!account)
    return new Response("Account not found", {status: 404});
  const activities = await db.query.activities.findMany({
    where: (activities, {eq}) =>
      eq(activities.athlete, account.providerAccountId),
  });
  const csv = stringify(
    activities.map(
      ({
        id,
        distance,
        type,
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
        type,
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
      })
    ),
    {header: true}
  );
  return new Response(csv, {
    headers: {"Content-Type": "text/csv"},
  });
}
