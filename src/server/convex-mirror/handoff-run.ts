import 'server-only';

import { db } from '~/server/db';
import type { Writer } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import { dispatchWebhookInboxToConvex } from '~/server/strava/webhook-dispatch';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import {
  type HandoffDeps,
  type HandoffReport,
  handBackToPostgres,
  handOffToConvex,
} from './handoff';
import { postgresWriterStore } from './handoff-postgres';
import { shadowActor } from './postgres-source';
import { checkShadowParity } from './shadow-parity';
import { runShadowMirror } from './shadow-run';

/** The two stores and the copy between them, for one account. */
async function depsFor(userId: string): Promise<HandoffDeps> {
  const actor = await shadowActor(userId);
  const bridge = convexWriteBridge(actor);
  if (!bridge) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  return {
    postgres: postgresWriterStore(db, userId),
    convex: {
      async state() {
        const state = await bridge.write<{
          backend: string;
          revoked: boolean;
          writer: Writer;
          writerEpoch: number;
        } | null>({ kind: 'state' });
        return (
          state && {
            backend: state.backend,
            revoked: state.revoked,
            writer: state.writer,
            epoch: state.writerEpoch,
          }
        );
      },
      setWriter: (writer, expectedEpoch) =>
        bridge.write<number | null>({
          kind: 'setWriter',
          writer,
          expectedEpoch,
        }),
    },
    async mirror(deadline) {
      const result = await runShadowMirror(userId, deadline);
      return { complete: 'complete' in result && result.complete };
    },
    async parity() {
      const report = await checkShadowParity(userId);
      if (report.status === 'drift')
        logger.error('Handoff stopped by parity drift', { userId, ...report });
      return report;
    },
    dispatch: () => dispatchWebhookInboxToConvex(),
  };
}

async function logged(
  direction: 'to Convex' | 'to Postgres',
  userId: string,
  run: (deps: HandoffDeps) => Promise<HandoffReport>,
) {
  const report = await run(await depsFor(userId));
  logger.info(`Library handoff ${direction}`, { userId, ...report });
  return report;
}

/** Make Convex the writer of an account's library. */
export const moveLibraryToConvex = (userId: string) =>
  logged('to Convex', userId, handOffToConvex);

/** Make Postgres the writer again; it catches up from Strava. */
export const moveLibraryToPostgres = (userId: string) =>
  logged('to Postgres', userId, handBackToPostgres);
