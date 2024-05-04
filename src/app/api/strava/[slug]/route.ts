import type {NextRequest} from "next/server";

import {
  activities,
  type Activity,
} from "~/server/db/schema";
import {db} from "~/server/db";
import {
  getActivity,
  getActivities,
  checkWebhook,
  requestWebhook,
  deleteWebhook,
  updateActivity,
  getAccessToken,
  type UpdatableActivity,
} from "../helpers";
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

  if (params.slug === "checkwebhook") {
    const json = await checkWebhook();
    return Response.json(json);
  }

  if (params.slug === "requestwebhook") {
    const url = req.nextUrl.searchParams.get("url");
    if (!url)
      return new Response("Missing URL", {status: 400});
    try {
      const response = await requestWebhook(url);
      console.log(response);
      return new Response("Webhook created");
    } catch (e) {
      console.error(e);
      return new Response("Failed to create webhook", {
        status: 500,
      });
    }
  }

  if (params.slug === "deletewebhook") {
    if (!req.nextUrl.searchParams.has("id"))
      return new Response("Missing id", {status: 400});
    const id = parseInt(
      req.nextUrl.searchParams.get("id")!
    );
    try {
      await deleteWebhook(id);
      return new Response("Webhook deleted");
    } catch (e) {
      console.error(e);
      return new Response("Failed to delete webhook", {
        status: 500,
      });
    }
  }

  if (!params.slug)
    return new Response(`Provide a valid slug`, {
      status: 404,
    });

  const token = await getAccessToken();
  if (!token) {
    return new Response("No token", {status: 401});
  }

  if (params.slug === "activity") {
    if (!req.nextUrl.searchParams.has("id"))
      return new Response("Missing id", {status: 400});
    const id = parseInt(
      req.nextUrl.searchParams.get("id")!
    );
    try {
      const new_data = await getActivity(id, {
        token,
        database: true,
        get_photos: true,
      });
      return Response.json(new_data.activities);
    } catch (e) {
      console.error(e);
      return new Response("Failed to fetch activity", {
        status: 500,
      });
    }
  } else if (params.slug === "activities") {
    try {
      const reqParams = {} as {
        get_photos?: boolean;
        page?: number;
        after?: number;
        before?: number;
      };
      if (req.nextUrl.searchParams.has("photos"))
        reqParams.get_photos =
          req.nextUrl.searchParams.get("photos") == "true";
      if (req.nextUrl.searchParams.has("page"))
        reqParams.page = parseInt(
          req.nextUrl.searchParams.get("page")!
        );
      if (req.nextUrl.searchParams.has("after"))
        reqParams.after = parseInt(
          req.nextUrl.searchParams.get("after")!
        );
      if (req.nextUrl.searchParams.has("before"))
        reqParams.before = parseInt(
          req.nextUrl.searchParams.get("before")!
        );
      console.log(reqParams);
      const new_data = await getActivities({
        token,
        database: true,
        ...reqParams,
      });
      return Response.json(new_data.activities);
    } catch (e) {
      console.error(e);
      return new Response("Failed to fetch activities", {
        status: 500,
      });
    }
  } else {
    return new Response("Not implemented", {status: 501});
  }
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
  if (params.slug === "update") {
    try {
      const data = (await req.json()) as UpdatableActivity;
      const token = await getAccessToken();
      const updated = await updateActivity(data, {token});
      return Response.json(updated);
    } catch (e) {
      console.log(e);
      return new Response("Failed to update activity", {
        status: 500,
      });
    }
  }
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
          .where(eq(activities.id, BigInt(data.object_id)));
        return new Response(
          `Deleted activity ${data.object_id}`
        );
      }
      const account = await db.query.accounts.findFirst({
        where: (accounts, {eq}) =>
          eq(accounts.providerAccountId, data.owner_id),
      });
      if (!account)
        return new Response("Account not found", {
          status: 404,
        });
      if (
        data.aspect_type === "create" ||
        data.aspect_type === "update"
      ) {
        await getActivity(data.object_id, {
          token: account.access_token!,
          database: true,
          get_photos: true,
        });
        return new Response(
          `Created/updated activity ${data.object_id}`
        );
      }
    }
  } catch (e) {
    console.error(e);
    return new Response("Webhook request failed", {
      status: 400,
    });
  }
}
