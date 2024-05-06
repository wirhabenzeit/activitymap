import type {Session} from "next-auth";
import {auth} from "~/auth";
import {db} from "~/server/db";

export async function GET() {
  const session: Session | null = await auth();
  if (!session?.user?.id)
    return new Response("Not authenticated", {status: 401});
  const account = await db.query.accounts.findFirst({
    where: (accounts, {eq}) =>
      eq(accounts.userId, session.user!.id!),
  });
  if (!account)
    return new Response("Account not found", {status: 404});
  const activities = await db.query.activities.findMany({
    where: (activities, {eq}) =>
      eq(activities.athlete, account.providerAccountId),
  });
  return Response.json(activities);
}
