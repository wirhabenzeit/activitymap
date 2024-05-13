"use server";

import {
  activities,
  photos,
  type Activity,
  type Photo,
} from "~/server/db/schema";

import {decode} from "@mapbox/polyline";

import {db} from "~/server/db";
import {getAccount} from "~/server/db/actions";
import {getTableColumns, sql} from "drizzle-orm";
import {PgTable} from "drizzle-orm/pg-core";

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
  name: string | null;
  description: string | null;
};

async function get(
  path: string,
  {token, method = "GET"}: {token?: string; method?: string}
) {
  const options =
    token === undefined
      ? {method}
      : {
          method,
          headers: {Authorization: `Bearer ${token}`},
        };
  const res = await fetch(
    `https://www.strava.com/api/v3/${path}`,
    options
  );
  console.log("GET", path, res.status, res.statusText);
  if (res.status == 204) return;
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${path}: ${res.status}`
    );
  }
  const json: unknown = await res.json();
  if (!json) {
    throw new Error(`Failed to fetch ${path}`);
  }
  return json;
}

export async function post(
  path: string,
  body: Record<string, unknown>,
  {
    token,
    method = "POST",
  }: {token?: string; method?: string}
) {
  const headers =
    token === undefined
      ? {"Content-Type": "application/json"}
      : {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };
  const res = await fetch(
    `https://www.strava.com/api/v3/${path}`,
    {method: method, headers, body: JSON.stringify(body)}
  );
  console.log(
    method,
    path,
    headers,
    JSON.stringify(body),
    res.status,
    res.statusText
  );
  if (!res.ok) {
    console.log(await res.text());
    throw new Error(
      `Failed to post ${path}: ${res.status}, ${res.statusText}`
    );
  }
  const json: Record<string, unknown> = await res.json();
  if (!json) {
    throw new Error(`Failed to post ${path}`);
  }
  return json;
}

export async function checkWebhook() {
  const json = (await get(
    `push_subscriptions?client_id=${process.env.AUTH_STRAVA_ID}&client_secret=${process.env.AUTH_STRAVA_SECRET}`,
    {}
  )) as Subscription[];
  return json.map(({id, callback_url}) => ({
    id,
    callback_url,
  }));
}

export async function requestWebhook(url: string) {
  const json = await post(
    `push_subscriptions`,
    {
      callback_url: url,
      verify_token: "STRAVA",
      client_id: process.env.AUTH_STRAVA_ID,
      client_secret: process.env.AUTH_STRAVA_SECRET,
    },
    {}
  );
  return json;
}

export async function deleteWebhook(id: number) {
  try {
    await get(
      `push_subscriptions/${id}?client_id=${process.env.AUTH_STRAVA_ID}&client_secret=${process.env.AUTH_STRAVA_SECRET}`,
      {method: "DELETE"}
    );
    return;
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to delete webhook`);
  }
}

export async function updateActivity(
  act: UpdatableActivity
) {
  try {
    const account = await getAccount();
    const access_token = account.access_token!;
    const {id, ...update} = act;
    console.log("Updating activity", id, update);
    const json = await post(
      `activities/${act.id}`,
      update,
      {
        token: access_token,
        method: "PUT",
      }
    );
    console.log("Updated activity");
    const parsedActivity: Activity = parseActivity(
      json as Record<string, unknown>
    );
    return parsedActivity;
  } catch (e) {
    console.log(e);
    throw new Error(`Failed to update activity`);
  }
}

function parseActivity(
  json: Record<string, unknown>
): Activity {
  const tableKeys = Object.keys(activities);
  const filteredInput = Object.fromEntries(
    Object.entries(json).filter(([key]) =>
      tableKeys.includes(key)
    )
  );
  if (
    "athlete" in filteredInput &&
    typeof filteredInput.athlete === "object" &&
    filteredInput.athlete !== null &&
    "id" in filteredInput.athlete
  )
    filteredInput.athlete = filteredInput.athlete.id;
  const start_date = new Date(
    filteredInput.start_date as string
  );
  const local_date = new Date(
    start_date.toLocaleString("en-US", {
      timeZone: (filteredInput.timezone as string)
        .split(" ")
        .pop(),
    })
  );
  filteredInput.start_date = start_date;
  filteredInput.start_date_local = local_date;
  filteredInput.start_date_local_timestamp =
    local_date.getTime() / 1000;
  filteredInput.detailed_activity =
    "description" in filteredInput;
  if (
    filteredInput.map &&
    typeof filteredInput.map == "object" &&
    "summary_polyline" in filteredInput.map &&
    typeof filteredInput.map.summary_polyline == "string"
  ) {
    const coordinates = decode(
      filteredInput.map.summary_polyline
    ).map(([lat, lon]) => [lon, lat]);
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
        [Infinity, Infinity, -Infinity, -Infinity]
      ),
    };
  }

  return filteredInput as Activity;
}

function parsePhoto(
  json: Record<keyof Photo, unknown>,
  {location = null}: {location: number[] | null | undefined}
): Photo {
  const tableKeys = Object.keys(photos);
  const filteredInput = Object.fromEntries(
    Object.entries(json).filter(([key, value]) =>
      tableKeys.includes(key)
    )
  );
  for (const key of ["uploaded_at", "created_at"])
    if (filteredInput[key])
      filteredInput[key] = new Date(
        filteredInput[key] as string
      );
  if (!filteredInput.location && location)
    filteredInput.location = location;
  return filteredInput as Photo;
}

export async function getPhotos(
  locations: Record<number, [number, number] | null>,
  {
    token,
    sizes = [2048],
  }: {
    token: string;
    sizes: number[];
  }
): Promise<Photo[]> {
  try {
    const promises = sizes
      .map((size) =>
        Object.keys(locations).map((id) =>
          get(
            `activities/${id}/photos?size=${size}&photo_sources=true`,
            {token}
          )
        )
      )
      .flat();
    const activityPhotos = (
      await Promise.all(promises)
    ).flat() as Record<keyof Photo, unknown>[];
    const photoDictionary: Record<string, Photo> =
      activityPhotos.reduce(
        (acc: Record<string, Photo>, photo: Photo) => {
          if (!acc[photo.unique_id])
            acc[photo.unique_id] = parsePhoto(photo, {
              location:
                locations[photo.activity_id!] || null,
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
        {} as Record<string, Photo>
      );
    return Object.values(photoDictionary);
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to fetch photos`);
  }
}

const buildConflictUpdateColumns = <
  T extends PgTable,
  Q extends keyof T["_"]["columns"]
>(
  table: T,
  filter: (column: string) => boolean = () => true
) =>
  Object.fromEntries(
    Object.keys(getTableColumns(table))
      .filter(filter)
      .map((column) => [
        column as Q,
        sql.raw(`excluded.${column}`),
      ])
  );

export async function getActivities({
  database = true,
  get_photos = false,
  page = 1,
  ids,
  per_page = 200,
  after,
  before,
}: {
  database?: boolean;
  get_photos?: boolean;
  page?: number;
  ids?: number[];
  per_page?: number;
  after?: number;
  before?: number;
}) {
  try {
    const access_token = (await getAccount()).access_token!;
    let new_activities: Record<string, unknown>[] = [];
    if (ids !== undefined)
      new_activities = (await Promise.all(
        ids.map((id) =>
          get(`activities/${id}`, {token: access_token})
        )
      )) as Record<string, unknown>[];
    else {
      const params = new URLSearchParams(
        Object.fromEntries(
          Object.entries({
            page,
            per_page,
            after,
            before,
          }).filter(([, v]) => v !== undefined)
        )
      );
      console.log(params.toString());
      new_activities = (await get(
        `athlete/activities?${params.toString()}`,
        {token: access_token}
      )) as Record<string, unknown>[];
    }
    const parsedActivities: Activity[] =
      new_activities.map(parseActivity);
    const new_photos: Photo[] = get_photos
      ? await getPhotos(
          Object.fromEntries(
            parsedActivities
              .filter((x) => x.total_photo_count > 0)
              .map(({id, start_latlng: location}) => [
                id,
                location,
              ])
          ),
          {
            token: access_token,
            sizes: [256, 2048],
          }
        )
      : [];
    if (database) {
      const insertedActivities = await db
        .insert(activities)
        .values(parsedActivities)
        .onConflictDoUpdate({
          target: activities.id,
          set: buildConflictUpdateColumns(
            activities,
            (column) =>
              ids != undefined ||
              (column != "description" &&
                column != "map" &&
                column != "detailed_activity")
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
