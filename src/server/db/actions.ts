"use server";

import {inArray, eq} from "drizzle-orm";
import {auth} from "~/auth";
import {type Activity, activities} from "./schema";
import {db} from "./index";
import {getAccount} from "~/auth";

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
      .where(inArray(activities.id, ids.map(BigInt)));
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
