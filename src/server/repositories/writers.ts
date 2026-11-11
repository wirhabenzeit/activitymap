import 'server-only';

import { findUserInternal } from '~/server/db/internal';
import type { Writer } from '~/server/db/schema';

/**
 * Which store writes a user's library (`users.writer`,
 * src/server/db/writer-fence.ts). A user that does not exist is answered
 * `postgres`: there is nothing of theirs for another store to write.
 */
export async function writerOf(userId: string): Promise<Writer> {
  return (await findUserInternal(userId))?.writer ?? 'postgres';
}
