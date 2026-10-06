// Local, reproducible visual review using the same input and reporting date as SwiftUI.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound } from 'next/navigation';
import { StatsTileGrid } from '~/components/stats/tiles';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { toStatsActivity } from '~/lib/stats/tile-series';
import { dayFromISODate } from '~/lib/stats/tile-data';

export default async function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  // Development only (see above): the ignore comment stops the dynamic path
  // from making Turbopack trace the whole project into the production bundle.
  const fixture = JSON.parse(
    await readFile(
      /* turbopackIgnore: true */ process.env.ACTIVITYMAP_GALLERY_LIBRARY ??
        join(
          process.cwd(),
          'ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json',
        ),
      'utf8',
    ),
  ) as { activities: Record<string, unknown>[] };
  const nullableFields = Object.fromEntries(
    Object.keys(activityDTOSchema.shape)
      .filter((key) => key !== 'streams')
      .map((key) => [key, null]),
  );
  const activities = fixture.activities.map((raw) =>
    toStatsActivity(
      dtoToActivity(activityDTOSchema.parse({ ...nullableFields, ...raw })),
    ),
  );
  return (
    <StatsTileGrid
      activities={activities}
      reportingDay={dayFromISODate(
        process.env.ACTIVITYMAP_STATS_GALLERY_DAY ?? '2026-09-22',
      )}
    />
  );
}
