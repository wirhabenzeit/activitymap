import { readFile } from 'node:fs/promises';

import { notFound } from 'next/navigation';
import { z } from 'zod';

import StatsFocusPreview from './preview';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();
  if ((await searchParams).data === 'dev') {
    const previewPath = process.env.ACTIVITYMAP_STATS_PREVIEW_FILE;
    if (!previewPath) notFound();
    // An explicitly requested, local export; never fetch or bundle library data.
    const snapshot = z
      .object({
        activities: z.array(z.record(z.string(), z.unknown())),
        reportingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(JSON.parse(await readFile(previewPath, 'utf8')));
    return <StatsFocusPreview snapshot={snapshot} />;
  }
  return <StatsFocusPreview />;
}
