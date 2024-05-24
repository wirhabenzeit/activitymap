"use server";

import {inArray, eq, count} from "drizzle-orm";
import {
  type Activity,
  type Account,
  activities,
  photos,
  accounts,
} from "./schema";
import {db} from "./index";
import {auth} from "~/auth";
import {range} from "d3";

export const getUser = async (id?: string) => {
  if (!id) {
    const session = await auth();
    if (!session?.user?.id)
      throw new Error("Not authenticated");
    id = session.user.id!;
  }
  const user = await db.query.users.findFirst({
    where: (users, {eq}) => eq(users.id, id),
  });
  if (!user) throw new Error("User not found");
  return user;
};

export const getAccount = async (
  providerAccountId?: number
) => {
  let account: Account;
  if (!providerAccountId) {
    const user = await getUser();
    account = (await db.query.accounts.findFirst({
      where: (accounts, {eq}) =>
        eq(accounts.userId, user.id),
    })) as Account;
  } else {
    account = (await db.query.accounts.findFirst({
      where: (accounts, {eq}) =>
        eq(accounts.providerAccountId, providerAccountId),
    })) as Account;
  }
  if (!account) throw new Error("Account not found");
  if (
    account.expires_at &&
    account.expires_at * 1000 < Date.now()
  ) {
    try {
      const response = await fetch(
        "https://www.strava.com/api/v3/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: process.env.AUTH_STRAVA_ID,
            client_secret: process.env.AUTH_STRAVA_SECRET,
            grant_type: "refresh_token",
            refresh_token: account.refresh_token,
          }),
        }
      );

      const tokens = (await response.json()) as Record<
        string,
        unknown
      >;

      console.log("Refreshed access token", tokens);

      if (!response.ok) throw tokens;

      account.access_token = tokens.access_token as string;
      account.expires_at = Math.floor(
        Date.now() / 1000 + (tokens.expires_in as number)
      );
      account.refresh_token =
        (tokens.refresh_token as string) ??
        account.refresh_token;

      await db
        .insert(accounts)
        .values(account)
        .onConflictDoUpdate({
          target: accounts.providerAccountId,
          set: account,
        });
    } catch (error) {
      console.error("Error refreshing access token", error);
      throw new Error("Failed to refresh access token");
    }
  }
  return account;
};

export async function getActivities({
  ids,
  athlete_id,
  summary = false,
}: {
  ids?: number[];
  athlete_id?: number;
  summary?: boolean;
}) {
  let acts: Activity[];
  if (summary) {
    acts = await db
      .select()
      .from(activities)
      .where(eq(activities.detailed_activity, false));
  } else if (ids !== undefined)
    acts = await db
      .select()
      .from(activities)
      .where(inArray(activities.id, ids));
  else {
    if (athlete_id == undefined) {
      const athlete = await getAccount();
      athlete_id = athlete.providerAccountId;
    }
    acts = await db
      .select()
      .from(activities)
      .where(eq(activities.athlete, athlete_id));
  }
  return acts;
}

export async function getActivitiesPaged({
  athlete_id,
  pageSize = 100,
}: {
  athlete_id?: number;
  pageSize: number;
}) {
  if (athlete_id == undefined) {
    const athlete = await getAccount();
    athlete_id = athlete.providerAccountId;
  }
  const actCount =
    (
      await db
        .select({count: count()})
        .from(activities)
        .where(eq(activities.athlete, athlete_id))
    )[0]?.count ?? 0;
  const pages = Math.ceil(actCount / pageSize);
  const promises = range(pages).map((pageNumber) =>
    db
      .select()
      .from(activities)
      .where(eq(activities.athlete, athlete_id))
      .limit(pageSize)
      .offset(pageNumber * pageSize)
  );
  return promises;
}

export async function getPhotos() {
  const athlete = await getAccount();

  const phts = await db
    .select()
    .from(photos)
    .where(
      eq(photos.athlete_id, athlete.providerAccountId)
    );
  return phts;
}
