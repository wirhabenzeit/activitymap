import 'server-only';
import { asc, eq, isNotNull, sql, and } from 'drizzle-orm';
import type { db } from '~/server/db';
import { activityStreams } from '~/server/db/schema';
import {
  packStreamSummary,
  unpackStreamSummary,
} from '~/lib/streams/compact-summary';

/** One bounded, atomic conversion batch. Never selects or fetches raw samples. */
export async function convertStreamSummaryBatch(
  database: typeof db,
  options: { format: 'polyline-v1' | 'json'; limit?: number; apply?: boolean },
) {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Batch limit must be 1–1000');
  return database.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    const rows = await tx
      .select({
        id: activityStreams.activityId,
        summary: activityStreams.summary,
      })
      .from(activityStreams)
      .where(
        and(
          isNotNull(activityStreams.summary),
          options.format === 'json'
            ? sql`${activityStreams.summary}->>'codec' is not null`
            : sql`${activityStreams.summary}->>'codec' is distinct from 'polyline-v1'`,
        ),
      )
      .orderBy(asc(activityStreams.activityId))
      .limit(limit)
      .for('update', { skipLocked: true });
    let beforeBytes = 0,
      afterBytes = 0;
    for (const row of rows) {
      const value =
        options.format === 'json'
          ? unpackStreamSummary(row.summary!)
          : packStreamSummary(row.summary!);
      beforeBytes += Buffer.byteLength(JSON.stringify(row.summary));
      afterBytes += Buffer.byteLength(JSON.stringify(value));
      if (options.apply)
        await tx
          .update(activityStreams)
          .set({ summary: value })
          .where(eq(activityStreams.activityId, row.id));
    }
    return {
      selected: rows.length,
      updated: options.apply ? rows.length : 0,
      beforeJsonBytes: beforeBytes,
      afterJsonBytes: afterBytes,
    };
  });
}
