// Development-only capture bridge. No data is fetched or persisted by this module.
import type { QueryClient } from '@tanstack/react-query';
import type { Map as MapboxMap } from 'mapbox-gl';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { store } from '~/store';

declare global {
  interface Window {
    __ACTIVITYMAP_GALLERY__?: {
      activities: Record<string, unknown>[];
      selectedIDs: number[];
      search?: string;
    };
    __ACTIVITYMAP_GALLERY_READY__?: boolean;
    __ACTIVITYMAP_GALLERY_MAP__?: MapboxMap;
  }
}

export function prepareGallery(client: QueryClient): boolean {
  if (process.env.NODE_ENV !== 'development' || !window.__ACTIVITYMAP_GALLERY__) return false;
  const fixture = window.__ACTIVITYMAP_GALLERY__;
  // Swift accepts absent nullable DTO fields. Normalize them before applying
  // the same production DTO mapper used by web sync.
  const activities = fixture.activities.map((raw) => dtoToActivity(activityDTOSchema.parse({
    ...Object.fromEntries(Object.keys(activityDTOSchema.shape).filter((key) => key !== 'streams').map((key) => [key, null])),
    ...raw,
  })));
  // An empty final page prevents ActivityStreamer from requesting live data,
  // including when a full local export contains more than 500 activities.
  client.setQueryData(['activities', 'auth', null, null, null, ''], {
    pages: [activities, []], pageParams: [0, activities.length],
  });
  client.setQueryData(['photos', null], []);
  store.getState().initializeAuth({ currentUser: null });
  store.getState().setSelected(fixture.selectedIDs);
  store.setState({ search: fixture.search ?? '' });
  window.__ACTIVITYMAP_GALLERY_READY__ = true;
  return true;
}
