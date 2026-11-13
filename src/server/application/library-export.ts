import type { ActivityDTO } from '~/contracts/v1/activity';
import type { Actor } from '~/server/auth/actor';

type Pages = {
  bootstrapPage(
    actor: Actor,
    args: { resource: 'activities'; afterKey?: string; limit: number },
  ): Promise<{
    more: boolean;
    page:
      | { resource: 'activities'; items: ActivityDTO[] }
      | { resource: 'photos'; items: unknown[] };
  }>;
};

/** Pages are also cut by size, so `more` decides, not the count. */
const PAGE = 500;

/**
 * The whole library of an account Convex writes for, in activity-ID order,
 * for the CSV export. Dates are `Date`s, matching the application record model.
 */
export async function libraryFromConvex(convex: Pages, actor: Actor) {
  const rows: (Omit<ActivityDTO, 'start_date_local'> & {
    start_date_local: Date;
  })[] = [];
  let afterKey: string | undefined;
  for (;;) {
    const { page, more } = await convex.bootstrapPage(actor, {
      resource: 'activities',
      afterKey,
      limit: PAGE,
    });
    if (page.resource !== 'activities')
      throw new Error('Unexpected export page');
    for (const item of page.items)
      rows.push({ ...item, start_date_local: new Date(item.start_date_local) });
    const last = page.items.at(-1)?.id;
    // A page that does not advance would repeat forever.
    if (!more || last === undefined || last === afterKey) break;
    afterKey = last;
  }
  return rows;
}
