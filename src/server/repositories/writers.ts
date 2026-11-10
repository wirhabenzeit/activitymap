import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '~/server/db';
import { type Writer, users } from '~/server/db/schema';

/**
 * Which store writes a user's library (`users.writer`,
 * src/server/db/writer-fence.ts). A user that does not exist is answered
 * `postgres`: there is nothing of theirs for another store to write.
 */
export async function writerOf(userId: string): Promise<Writer> {
  const [user] = await db
    .select({ writer: users.writer })
    .from(users)
    .where(eq(users.id, userId));
  return user?.writer ?? 'postgres';
}
