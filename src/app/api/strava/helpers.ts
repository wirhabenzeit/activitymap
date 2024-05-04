import {
  activities,
  photos,
  type Activity,
  type Photo,
} from "~/server/db/schema";

import {decode} from "@mapbox/polyline";

import {db} from "~/server/db";
import {Session} from "next-auth";
import {auth} from "~/auth";

export async function getAccessToken() {
  const session: Session | null = await auth();
  if (!session?.user?.id)
    throw new Error("No user session found");
  const account = await db.query.accounts.findFirst({
    where: (accounts, {eq}) =>
      eq(accounts.userId, session.user!.id!),
  });
  if (!account || !account.access_token)
    throw new Error("No account found");
  return account.access_token;
}

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
    `https://www.strava.com/api/v3/${path}`,
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

type Subscription = {
  id: number;
  resource_state: number;
  callback_url: string;
  application_id: number;
  created_at: string;
  updated_at: string;
};

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

export type UpdatableActivity = {
  id: number;
  name?: string;
  description?: string;
};

export async function updateActivity(
  act: UpdatableActivity,
  {token}: {token: string}
) {
  try {
    const {id, ...update} = act;
    console.log("Updating activity", id, update);
    const json = await post(
      `activities/${act.id}`,
      update,
      {
        token,
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

export function parseActivity(
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
  filteredInput.start_date_local_timestamp = BigInt(
    local_date.getTime() / 1000
  );
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

export function parsePhoto(
  json: Record<string, unknown>,
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

interface IDandLoc {
  id: bigint;
  location: number[] | null;
}

export async function getPhotos(
  idLocs: IDandLoc[] | IDandLoc,
  {
    token,
  }: {
    token: string;
  }
): Promise<Photo[]> {
  try {
    const idLocsArr = Array.isArray(idLocs)
      ? idLocs
      : [idLocs];
    const promises = idLocsArr.map(({id}) =>
      get(`activities/${id}/photos`, {token})
    );
    const activityPhotos = (await Promise.all(
      promises
    )) as Record<string, unknown>[][];
    return activityPhotos
      .map((x: Record<string, unknown>[], i): Photo[] =>
        x.map(
          (y: Record<string, unknown>): Photo =>
            parsePhoto(y, {
              location: idLocsArr[i]?.location,
            })
        )
      )
      .flat();
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to fetch photos`);
  }
}

export async function getActivities({
  token,
  database = true,
  get_photos = false,
  page = 1,
  per_page = 200,
  after = undefined,
  before = undefined,
}: {
  token: string;
  database?: boolean;
  get_photos?: boolean;

  page?: number;
  per_page?: number;
  after?: number;
  before?: number;
}) {
  try {
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
    const new_activities: Record<string, unknown>[] =
      (await get(
        `athlete/activities?${params.toString()}`,
        {token}
      )) as Record<string, unknown>[];
    const parsedActivities: Activity[] =
      new_activities.map(parseActivity);
    const new_photos: Photo[] = get_photos
      ? await getPhotos(
          parsedActivities
            .filter((x) => x.total_photo_count)
            .map(({id, start_latlng: location}) => ({
              id,
              location,
            })),
          {
            token,
          }
        )
      : [];
    if (database) {
      await db
        .insert(activities)
        .values(parsedActivities)
        .onConflictDoNothing();
      if (new_photos.length > 0)
        await db
          .insert(photos)
          .values(new_photos)
          .onConflictDoNothing();
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

export async function getActivity(
  id: number,
  {
    token,
    database = true,
    get_photos = true,
  }: {
    token: string;
    database?: boolean;
    get_photos?: boolean;
  }
) {
  try {
    const activity = (await get(`activities/${id}`, {
      token,
    })) as Record<string, unknown>;
    const parsedActivity = parseActivity(activity);
    const new_photos: Photo[] =
      get_photos &&
      "photos" in activity &&
      typeof activity.photos === "object" &&
      activity.photos &&
      "count" in activity.photos &&
      activity.photos.count
        ? await getPhotos(
            {
              id: parsedActivity.id,
              location: parsedActivity.start_latlng,
            },
            {
              token,
            }
          )
        : [];
    if (database) {
      await db
        .insert(activities)
        .values(parsedActivity)
        .onConflictDoUpdate({
          target: activities.id,
          set: parsedActivity,
        });
      if (new_photos.length > 0)
        await db
          .insert(photos)
          .values(new_photos)
          .onConflictDoNothing();
    }
    return {
      activities: [parsedActivity],
      photos: new_photos,
    };
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to fetch activity`);
  }
}
