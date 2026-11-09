'use client';

import type { ActivityDTO } from '~/contracts/v1/activity';

/**
 * Live preview owners hold activity cards without the detailed polyline.
 * Views that need it (GPX export) ask the live library for the full activity.
 */
type DetailLoader = (id: string) => Promise<ActivityDTO | null>;
const loaders = new Map<string, DetailLoader>();

export function setLiveDetailLoader(
  scope: string,
  loader: DetailLoader | null,
) {
  if (loader) loaders.set(scope, loader);
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
  else loaders.delete(scope);
}

/** The full activity when a live library serves this scope, else null. */
export async function loadLiveActivityDetail(scope: string, id: string) {
  const loader = loaders.get(scope);
  return loader ? loader(id) : null;
}
