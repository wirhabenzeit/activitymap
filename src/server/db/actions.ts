"use server";

import {inArray, eq} from "drizzle-orm";
import {auth} from "~/auth";
import {type Activity, activities, photos} from "./schema";
import {db} from "./index";
import {getAccount} from "~/auth";

export async function getUserAccount(id: string) {
  const account = await db.query.accounts.findFirst({
    where: (accounts, {eq}) => eq(accounts.userId, id),
  });
  const user = await db.query.users.findFirst({
    where: (users, {eq}) => eq(users.id, id),
  });
  return {account, user};
}

export async function getActivities({
  ids,
  athlete_id,
}: {
  ids?: number[];
  athlete_id?: number;
}) {
  let acts: Activity[];
  if (ids !== undefined)
    acts = await db
      .select()
      .from(activities)
      .where(inArray(activities.id, ids));
  else {
    if (athlete_id == undefined) {
      const session = await auth();
      if (!session?.user?.id)
        throw new Error("Not authenticated");
      const account = await getAccount({
        userID: session.user!.id!,
      });
      if (!account) throw new Error("Account not found");
      athlete_id = account.providerAccountId;
    }
    acts = await db
      .select()
      .from(activities)
      .where(eq(activities.athlete, athlete_id));
  }
  return acts;
}

export async function getPhotos(athlete_id: number) {
  const phts = await db
    .select()
    .from(photos)
    .where(eq(photos.athlete_id, athlete_id));
  return phts;
}
