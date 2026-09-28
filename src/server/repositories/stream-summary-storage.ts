import 'server-only';
import { asc, eq, gt, isNotNull, sql, and } from 'drizzle-orm';
import type { db } from '~/server/db';
import { activityStreams } from '~/server/db/schema';
import { streamActivityIdSchema } from '~/server/strava/streams';
import {
  packStreamSummary,
  unpackStreamSummary,
  type StoredStreamSummary,
} from '~/lib/streams/compact-summary';

/** Bounded conversion with per-row validation failures and an explicit scan cursor.
 * Invalid rows remain untouched; successful conversions in this batch still commit.
 * SQL/connection errors remain fatal and roll back the transaction.
 */
export async function convertStreamSummaryBatch(
  database: typeof db,
  options: {
    format: 'polyline-v1' | 'json';
    limit?: number;
    apply?: boolean;
    afterId?: string;
  },
) {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Batch limit must be 1–1000');
  if (options.afterId !== undefined)
    streamActivityIdSchema.parse(options.afterId);
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
          options.afterId === undefined
            ? undefined
            : gt(activityStreams.activityId, BigInt(options.afterId)),
          options.format === 'json'
            ? sql`${activityStreams.summary}->>'codec' is not null`
            : sql`${activityStreams.summary}->>'codec' is distinct from 'polyline-v1'`,
        ),
      )
      .orderBy(asc(activityStreams.activityId))
      .limit(limit)
      // Wait (bounded by statement_timeout) rather than skipping a locked row
      // behind the returned cursor. Retrying a timeout uses the same cursor.
      .for('update');
    let beforeBytes = 0,
      afterBytes = 0,
      converted = 0;
    const failures: { activityId: string; code: 'invalid_summary' }[] = [];
    for (const row of rows) {
      let value: StoredStreamSummary;
      try {
        value =
          options.format === 'json'
            ? unpackStreamSummary(row.summary!)
            : packStreamSummary(row.summary!);
      } catch {
        failures.push({ activityId: String(row.id), code: 'invalid_summary' });
        continue;
      }
      beforeBytes += Buffer.byteLength(JSON.stringify(row.summary));
      afterBytes += Buffer.byteLength(JSON.stringify(value));
      if (options.apply)
        await tx
          .update(activityStreams)
          .set({ summary: value })
          .where(eq(activityStreams.activityId, row.id));
      converted++;
    }
    return {
      selected: rows.length,
      converted,
      updated: options.apply ? converted : 0,
      failures,
      // Advances past bad rows too; callers must retain failures for repair.
      nextAfterId: rows.length ? String(rows[rows.length - 1]!.id) : null,
      beforeJsonBytes: beforeBytes,
      afterJsonBytes: afterBytes,
    };
  });
}
