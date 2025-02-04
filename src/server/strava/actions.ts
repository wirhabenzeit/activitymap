'use server';

import {
  activities as activitySchema,
  photos,
  SportType,
  users,
  type Activity,
  type Photo,
} from '~/server/db/schema';

import { decode } from '@mapbox/polyline';

import { db } from '~/server/db';
import { getAccount } from '~/server/db/actions';
import { getTableColumns, sql, eq, desc } from 'drizzle-orm';
import { type PgTable } from 'drizzle-orm/pg-core';

type Subscription = {
  id: number;
  resource_state: number;
  callback_url: string;
  application_id: number;
  created_at: string;
  updated_at: string;
};

export type UpdatableActivity = {
  id: number;
  athlete: number;
  name?: string;
  description?: string;
  sport_type?: SportType;
  commute?: boolean;
};

async function get(
  path: string,
  { token, method = 'GET' }: { token?: string; method?: string },
) {
  const options =
    token === undefined
      ? { method }
      : {
          method,
          headers: { Authorization: `Bearer ${token}` },
        };
  try {
    console.log('GET', path);
    const res = await fetch(`https://www.strava.com/api/v3/${path}`, options);
    console.log('GET', path, res.status, res.statusText);
    if (res.status == 204) return;
    if (!res.ok) {
      throw new Error(`Failed to fetch ${path}: ${res.status}`);
    }
    const json: unknown = await res.json();
    if (!json) {
      throw new Error(`Failed to fetch ${path}`);
    }
    //console.log(json);
    return json;
  } catch (e) {
    console.error(e);
    return;
  }
}

export async function post(
  path: string,
  body: Record<string, unknown>,
  { token, method = 'POST' }: { token?: string; method?: string },
) {
  const headers =
    token === undefined
      ? { 'Content-Type': 'application/json' }
      : ({
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        } as Record<string, string>);
  const res = await fetch(`https://www.strava.com/api/v3/${path}`, {
    method: method,
    headers,
    body: JSON.stringify(body),
  });
  console.log(
    method,
    path,
    headers,
    JSON.stringify(body),
    res.status,
    res.statusText,
  );
  if (!res.ok) {
    console.log(await res.text());
    throw new Error(`Failed to post ${path}: ${res.status}, ${res.statusText}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (!json) {
    throw new Error(`Failed to post ${path}`);
  }
  return json;
}

export async function checkWebhook() {
  const json = (await get(
    `push_subscriptions?client_id=${process.env.AUTH_STRAVA_ID}&client_secret=${process.env.AUTH_STRAVA_SECRET}`,
    {},
  )) as Subscription[];
  return json.map(({ id, callback_url }) => ({
    id,
    callback_url,
  }));
}

export async function requestWebhook(url: string) {
  const json = await post(
    `push_subscriptions`,
    {
      callback_url: url,
      verify_token: 'STRAVA',
      client_id: process.env.AUTH_STRAVA_ID,
      client_secret: process.env.AUTH_STRAVA_SECRET,
    },
    {},
  );
  return json;
}

export async function deleteWebhook(id: number) {
  try {
    await get(
      `push_subscriptions/${id}?client_id=${process.env.AUTH_STRAVA_ID}&client_secret=${process.env.AUTH_STRAVA_SECRET}`,
      { method: 'DELETE' },
    );
    return;
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to delete webhook`);
  }
}

export async function updateActivity(act: UpdatableActivity) {
  try {
    const account = await getAccount({});
    const access_token = account.access_token!;
    const { id, ...update } = act;
    console.log('Updating activity', id, update);
    const json = await post(`activities/${act.id}`, update, {
      token: access_token,
      method: 'PUT',
    });
    console.log('Updated activity');
    const parsedActivity: Activity = parseActivity(json);
    return parsedActivity;
  } catch (e) {
    console.log(e);
    throw new Error(`Failed to update activity`);
  }
}

function parseActivity(json: Record<string, unknown>): Activity {
  const tableKeys = Object.keys(activitySchema);
  const filteredInput = Object.fromEntries(
    Object.entries(json).filter(([key]) => tableKeys.includes(key)),
  );
  if (
    'athlete' in filteredInput &&
    typeof filteredInput.athlete === 'object' &&
    filteredInput.athlete !== null &&
    'id' in filteredInput.athlete
  )
    filteredInput.athlete = filteredInput.athlete.id;
  const start_date = new Date(filteredInput.start_date as string);
  const local_date = new Date(
    start_date.toLocaleString('en-US', {
      timeZone: (filteredInput.timezone as string).split(' ').pop(),
    }),
  );
  filteredInput.start_date = start_date;
  filteredInput.start_date_local = local_date;
  filteredInput.start_date_local_timestamp = local_date.getTime() / 1000;
  filteredInput.detailed_activity = 'description' in filteredInput;
  if (
    filteredInput.map &&
    typeof filteredInput.map == 'object' &&
    'summary_polyline' in filteredInput.map &&
    typeof filteredInput.map.summary_polyline == 'string'
  ) {
    const coordinates = decode(filteredInput.map.summary_polyline).map(
      ([lat, lon]) => [lon, lat],
    );
    filteredInput.map = {
      ...filteredInput.map,
      bbox: coordinates.reduce(
        (acc: number[], coord: number[]) => {
          return [
            Math.min(acc[0]!, coord[0]!),
            Math.min(acc[1]!, coord[1]!),
            Math.max(acc[2]!, coord[0]!),
            Math.max(acc[3]!, coord[1]!),
          ];
        },
        [Infinity, Infinity, -Infinity, -Infinity],
      ),
    };
  }

  return filteredInput as Activity;
}

function parsePhoto(
  json: Record<keyof Photo, unknown>,
  { location = null }: { location: number[] | null | undefined },
): Photo {
  const tableKeys = Object.keys(photos);
  const filteredInput = Object.fromEntries(
    Object.entries(json).filter(([key]) => tableKeys.includes(key)),
  );
  for (const key of ['uploaded_at', 'created_at'])
    if (filteredInput[key])
      filteredInput[key] = new Date(filteredInput[key] as string);
  if (!filteredInput.location && location) filteredInput.location = location;
  return filteredInput as Photo;
}

export async function getPhotos(
  phts: Record<number, { loc?: [number, number]; token: string }>,
  {
    sizes = [2048],
  }: {
    sizes: number[];
  },
): Promise<Photo[]> {
  try {
    const promises = sizes
      .map((size) =>
        Object.entries(phts).map(([id, { token }]) =>
          get(`activities/${id}/photos?size=${size}&photo_sources=true`, {
            token,
          }),
        ),
      )
      .flat();
    const activityPhotos = (await Promise.all(promises)).flat() as Record<
      keyof Photo,
      unknown
    >[];
    const photoDictionary: Record<string, Photo> = activityPhotos.reduce(
      (acc: Record<string, Photo>, photo: Photo) => {
        if (!acc[photo.unique_id])
          acc[photo.unique_id] = parsePhoto(photo, {
            location: phts[photo.activity_id!]?.loc || null,
          });
        if (acc[photo.unique_id]) {
          acc[photo.unique_id].sizes = {
            ...acc[photo.unique_id].sizes,
            ...photo.sizes,
          };
          acc[photo.unique_id].urls = {
            ...acc[photo.unique_id].urls,
            ...photo.urls,
          };
        }
        return acc;
      },
      {} as Record<string, Photo>,
    );
    return Object.values(photoDictionary);
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to fetch photos`);
  }
}

const buildConflictUpdateColumns = <
  T extends PgTable,
  Q extends keyof T['_']['columns'],
>(
  table: T,
  filter: (column: string) => boolean = () => true,
) =>
  Object.fromEntries(
    Object.keys(getTableColumns(table))
      .filter(filter)
      .map((column) => [column as Q, sql.raw(`excluded.${column}`)]),
  );

export async function getActivities({
  athlete_id,
  database = true,
  get_photos = false,
  page = 1,
  activities,
  per_page = 200,
  after,
  before,
}: {
  athlete_id?: number;
  database?: boolean;
  get_photos?: boolean;
  page?: number;
  activities?: { id: number; athlete: number }[];
  per_page?: number;
  after?: number;
  before?: number;
}) {
  try {
    let new_activities: Record<string, unknown>[] = [];
    let tokens = {} as Record<number, string>;
    if (activities !== undefined) {
      const athlete_ids = activities.map(({ athlete }) => athlete);
      const athlete_tokens = await Promise.all(
        athlete_ids.map((id) => getAccount({ providerAccountId: id })),
      );
      tokens = Object.fromEntries(
        athlete_tokens.map(({ providerAccountId, access_token }) => [
          providerAccountId,
          access_token!,
        ]),
      );
      //console.log(activities, tokens);
      new_activities = (await Promise.all(
        activities.map(({ id, athlete }) =>
          get(`activities/${id}`, { token: tokens[athlete] }),
        ),
      )) as Record<string, unknown>[];
    } else {
      const account = athlete_id
        ? await getAccount({ providerAccountId: athlete_id })
        : await getAccount({});
      const access_token = account.access_token!;

      if (!before) {
        const oldestActivity = await db
          .select()
          .from(activitySchema)
          .where(eq(activitySchema.athlete, account.providerAccountId))
          .orderBy(activitySchema.start_date)
          .limit(1);

        if (oldestActivity && oldestActivity.length > 0) {
          before = Date.parse(oldestActivity[0]!.start_date) / 1000;
        }
      }

      const params = new URLSearchParams(
        Object.fromEntries(
          Object.entries({
            page,
            per_page,
            after,
            before,
          }).filter(([, v]) => v !== undefined),
        ),
      );
      console.log(params.toString());
      new_activities = (await get(`athlete/activities?${params.toString()}`, {
        token: access_token,
      })) as Record<string, unknown>[];
      if (new_activities.length > 0) {
        //console.log('new activities', new_activities[0]);
        const athlete_id = new_activities[0]!.athlete!.id as number;
        console.log('athlete id', athlete_id);
        if (athlete_id) {
          tokens[athlete_id] = access_token;
          //console.log('token', tokens[athlete_id]);
        }
        console.log(tokens);
      } else {
        const userID = account.userId;
        console.log('no new activities, setting complete', userID);
        if (userID) {
          db.update(users).set({ complete: true }).where(eq(users.id, userID));
        }
      }
    }
    const parsedActivities: Activity[] = new_activities.map(parseActivity);
    console.log(
      'Fetched activities',
      parsedActivities.length,
      'now fetching photos',
      tokens,
    );
    const new_photos: Photo[] = get_photos
      ? await getPhotos(
          Object.fromEntries(
            parsedActivities
              .filter((x) => x.total_photo_count > 0)
              .map(({ id, start_latlng: location, athlete }) => [
                id,
                { loc: location, token: tokens[athlete]! },
              ]),
          ),
          {
            sizes: [256, 2048],
          },
        )
      : [];
    if (database && parsedActivities.length > 0) {
      const insertedActivities = await db
        .insert(activitySchema)
        .values(parsedActivities)
        .onConflictDoUpdate({
          target: activitySchema.id,
          set: buildConflictUpdateColumns(
            activitySchema,
            (column) =>
              activities != undefined ||
              (column != 'description' &&
                column != 'map' &&
                column != 'detailed_activity'),
          ),
        })
        .returning();
      const insertedPhotos =
        new_photos.length > 0
          ? await db
              .insert(photos)
              .values(new_photos)
              .onConflictDoUpdate({
                target: [photos.unique_id],
                set: buildConflictUpdateColumns(photos),
              })
              .returning()
          : [];
      return {
        activities: insertedActivities,
        photos: insertedPhotos,
      };
    }
    return {
      activities: parsedActivities,
      photos: new_photos,
    };
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to fetch activities`);
  }
}
