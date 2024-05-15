import type {NextRequest} from "next/server";

import {
  activities,
  type Activity,
} from "~/server/db/schema";
import {db} from "~/server/db";
import {getActivities as getStravaActivities} from "~/server/strava/actions";
import {getActivities as getDBActivities} from "~/server/db/actions";
import {eq} from "drizzle-orm";

export async function GET(
  req: NextRequest,
  {params}: {params: {slug: string}}
) {
  if (params.slug === "webhook") {
    if (!req.nextUrl.searchParams.has("hub.challenge"))
      return new Response("Missing challenge", {
        status: 400,
      });
    return Response.json({
      "hub.challenge":
        req.nextUrl.searchParams.get("hub.challenge"),
    });
  }

  if (params.slug === "cron") {
    const numberToFetch =
      req.nextUrl.searchParams.get("number");
    const acts = await getDBActivities({summary: true});
    const newest = acts
      .sort(
        (a, b) =>
          b.start_date_local_timestamp -
          a.start_date_local_timestamp
      )
      .slice(
        0,
        numberToFetch ? parseInt(numberToFetch) : 30
      );
    console.log(
      "UPDATING",
      newest.map((a) => [a.name, a.id, a.athlete])
    );
    const detailedActs = await getStravaActivities({
      activities: newest.map(({id, athlete}) => ({
        id,
        athlete,
      })),
      database: true,
      get_photos: false,
    });
    return new Response(
      `Found ${
        acts.length
      } activities with missing details, updated ${
        detailedActs.activities.length
      } activities: ${detailedActs.activities
        .map((a) => a.name)
        .join(", ")}`
    );
  }

  return new Response(`Invalid endpoint`, {status: 404});
}

type WebhookRequestActivity = {
  aspect_type: "update" | "create" | "delete";
  object_id: number;
  object_type: "activity";
  owner_id: number;
  subscription_id: number;
  updates?: Partial<Activity>;
};

type WebhookRequestAthlete = {
  aspect_type: "update" | "create" | "delete";
  object_id: number;
  object_type: "athlete";
  owner_id: number;
  subscription_id: number;
  updates?: Record<string, unknown>;
};

type WebhookRequest =
  | WebhookRequestActivity
  | WebhookRequestAthlete;

export async function POST(
  req: NextRequest,
  {params}: {params: {slug: string}}
) {
  console.log(params.slug);
  if (params.slug !== "webhook")
    return new Response("Invalid endpoint", {status: 404});
  try {
    const data =
      await (req.json() as Promise<WebhookRequest>);
    console.log(data);
    if (data.object_type === "athlete") {
      return new Response("OK");
    } else {
      if (data.aspect_type === "delete") {
        await db
          .delete(activities)
          .where(eq(activities.id, data.object_id));
        return new Response(
          `Deleted activity ${data.object_id}`
        );
      }
      if (
        data.aspect_type === "create" ||
        data.aspect_type === "update"
      ) {
        await getStravaActivities({
          activities: [
            {id: data.object_id, athlete: data.owner_id},
          ],
          database: true,
          get_photos: true,
        });
        return new Response(
          `Created/updated activity ${data.object_id}`
        );
      }
      return new Response("Invalid aspect type", {
        status: 400,
      });
    }
  } catch (e) {
    console.error(e);
    return new Response("Webhook request failed", {
      status: 400,
    });
  }
}
