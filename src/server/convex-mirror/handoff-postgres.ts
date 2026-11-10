import { and, eq, sql } from 'drizzle-orm';

import type { db } from '~/server/db';
import { users } from '~/server/db/schema';

import type { HandoffDeps } from './handoff';

/** The Postgres side of a handoff for one account (`users.writer`,
 * src/server/db/writer-fence.ts). */
export function postgresWriterStore(
  database: typeof db,
  userId: string,
): HandoffDeps['postgres'] {
  return {
    async state() {
      const [user] = await database
        .select({ writer: users.writer, epoch: users.writerEpoch })
        .from(users)
        .where(eq(users.id, userId));
      return user ?? null;
    },
    // The update takes the lock every write for the account shares, so it
    // returns once writes already under way have finished.
    async setWriter(writer, expectedEpoch) {
      const [row] = await database
        .update(users)
        .set({ writer, writerEpoch: sql`${users.writerEpoch} + 1` })
        .where(and(eq(users.id, userId), eq(users.writerEpoch, expectedEpoch)))
        .returning({ epoch: users.writerEpoch });
      return row?.epoch ?? null;
    },
    // Reconciliation takes accounts it has never finished first.
    async reconcileNow() {
      await database
        .update(users)
        .set({ lastSummaryReconciledAt: null })
        .where(eq(users.id, userId));
    },
  };
}
