import { readMatchingTiles } from '../../../../../../backend/matching/tiles';
import type { PlaceQueryWindow } from '../../../../../../src/server/places/query-windows';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

export async function readTiledWindows(
  ctx: ActionCtx,
  args: {
    dataset: string;
    windows: readonly PlaceQueryWindow[];
    nonce?: string;
  },
  parallelism: 1 | 4,
) {
  return readMatchingTiles(
    args.windows,
    (
      tile,
      cursor,
    ): Promise<{
      page: Doc<'places'>[];
      isDone: boolean;
      continueCursor: string;
    }> =>
      ctx.runQuery(internal.lab.tilePage, {
        dataset: args.dataset,
        tile,
        paginationOpts: { numItems: 256, cursor },
        nonce: args.nonce,
      }),
    parallelism,
  );
}
