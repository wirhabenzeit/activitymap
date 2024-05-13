import type {NextRequest} from "next/server";

import {
  activities,
  type Activity,
} from "~/server/db/schema";
import {db} from "~/server/db";
import {getActivities} from "~/server/strava/actions";
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
    return new Response("OK");
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
        await getActivities({
          ids: [data.object_id],
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
