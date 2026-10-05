import 'server-only';

import { desc, lt } from 'drizzle-orm';

import { db } from '~/server/db';
import { scheduledJobLog, type ScheduledJobLogEntry } from '~/server/db/schema';

export type NewScheduledJobLogEntry = Omit<ScheduledJobLogEntry, 'id'>;

/** Short history of scheduled job runs for the admin dashboard (#328). */
export function createScheduledJobLogRepository(database: typeof db = db) {
  return {
    async append(entry: NewScheduledJobLogEntry) {
      await database.insert(scheduledJobLog).values(entry);
    },
    async recent(limit: number) {
      return database
        .select()
        .from(scheduledJobLog)
        .orderBy(desc(scheduledJobLog.startedAt))
        .limit(limit);
    },
    async deleteBefore(cutoff: Date) {
      const deleted = await database
        .delete(scheduledJobLog)
        .where(lt(scheduledJobLog.startedAt, cutoff))
        .returning({ id: scheduledJobLog.id });
      return deleted.length;
    },
  };
}

export type ScheduledJobLogRepository = ReturnType<
  typeof createScheduledJobLogRepository
>;

export const scheduledJobLogRepository = createScheduledJobLogRepository();
