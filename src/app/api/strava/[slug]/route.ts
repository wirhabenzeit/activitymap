import type { NextRequest } from 'next/server';

import {
  accounts,
  activities,
  photos,
  users as usersSchema,
  type Activity,
} from '~/server/db/schema';
import { db } from '~/server/db';
import { getActivities as getStravaActivities } from '~/server/strava/actions';
import { getActivities as getDBActivities } from '~/server/db/actions';
import { eq, inArray, ne } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ slug: string }> },
) {
  const params = await props.params;
  if (params.slug === 'webhook') {
    if (!req.nextUrl.searchParams.has('hub.challenge'))
      return new Response('Missing challenge', {
        status: 400,
      });
    return Response.json({
      'hub.challenge': req.nextUrl.searchParams.get('hub.challenge'),
    });
  }

  if (params.slug === 'cron') {
    const users = await db
      .select()
      .from(usersSchema)
      .where(ne(usersSchema.complete, true));

    const userIDs = users.map((u) => u.id);
    console.log('Getting mode activities for', userIDs);

    const athletes = await db
      .select()
      .from(accounts)
      .where(inArray(accounts.userId, userIDs));

    console.log('ATHLETES', athletes, userIDs);

    const athleteIDs = athletes.map((a) => a.providerAccountId).slice(0, 5);

    const promises = athleteIDs.map((id) =>
      getStravaActivities({ athlete_id: id, database: true }),
    );

    await Promise.all(promises);

    const numberToFetch = req.nextUrl.searchParams.get('number');
    const acts = await getDBActivities({ summary: true });
    const newest = acts
      .filter((a) => a.id !== 443702470) // remove buggy activity
      .sort(
        (a, b) => b.start_date_local_timestamp - a.start_date_local_timestamp,
      )
      .slice(0, numberToFetch ? parseInt(numberToFetch) : 30);
    console.log(
      'UPDATING',
      newest.map((a) => [a.name, a.id, a.athlete]),
    );
    const detailedActs = await getStravaActivities({
      activities: newest.map(({ id, athlete }) => ({
        id,
        athlete,
      })),
      database: true,
      get_photos: false,
    });

    return new Response(
      `Found ${acts.length} activities with missing details, updated ${
        detailedActs.activities.length
      } activities: ${detailedActs.activities.map((a) => a.name).join(', ')}\n Updated ${promises.length} athletes`,
    );
  }

  return new Response(`Invalid endpoint`, { status: 404 });
}

type WebhookRequestActivity = {
  aspect_type: 'update' | 'create' | 'delete';
  object_id: number;
  object_type: 'activity';
  owner_id: number;
  subscription_id: number;
  updates?: Partial<Activity>;
};

type WebhookRequestAthlete = {
  aspect_type: 'update' | 'create' | 'delete';
  object_id: number;
  object_type: 'athlete';
  owner_id: number;
  subscription_id: number;
  updates?: Record<string, unknown>;
};

type WebhookRequest = WebhookRequestActivity | WebhookRequestAthlete;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ slug: string }> },
) {
  const params = await props.params;
  console.log(params.slug);
  if (params.slug !== 'webhook')
    return new Response('Invalid endpoint', { status: 404 });
  try {
    const data = await (req.json() as Promise<WebhookRequest>);
    console.log(data);
    if (data.object_type === 'athlete') {
      return new Response('OK');
    } else {
      if (data.aspect_type === 'delete') {
        await db.delete(activities).where(eq(activities.id, data.object_id));
        return new Response(`Deleted activity ${data.object_id}`);
      }
      if (data.aspect_type === 'create' || data.aspect_type === 'update') {
        if (data.aspect_type === 'update') {
          // check for photos
          const del = await db
            .delete(photos)
            .where(eq(photos.activity_id, data.object_id));
          console.log('Deleted', del);
        }
        const athlete = await db
          .select()
          .from(accounts)
          .where(eq(accounts.providerAccountId, data.owner_id));
        if (athlete.length === 0) {
          return new Response('Athlete not found', {
            status: 400,
          });
        }
        await getStravaActivities({
          activities: [{ id: data.object_id, athlete: data.owner_id }],
          database: true,
          get_photos: true,
        });
        return new Response(`Created/updated activity ${data.object_id}`);
      }
      return new Response('Invalid aspect type', {
        status: 400,
      });
    }
  } catch (e) {
    console.error(e);
    return new Response('Webhook request failed', {
      status: 400,
    });
  }
}
