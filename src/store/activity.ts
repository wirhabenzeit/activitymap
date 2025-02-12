import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import type { Activity, Photo } from '~/server/db/schema';
import { type FeatureCollection, type Feature } from 'geojson';
import geosimplify from '@mapbox/geosimplify-js';
import { decode } from '@mapbox/polyline';
import {
  getActivities as getDBActivities,
  getActivitiesPaged,
  getPhotos,
} from '~/server/db/actions';
import {
  getActivities as getStravaActivities,
  UpdatableActivity,
  updateActivity as updateStravaActivity,
} from '~/server/strava/actions';

export type ActivityState = {
  activityDict: Record<number, Activity>;
  geoJson: FeatureCollection;
  loading: boolean;
  loaded: boolean;
  photos: Photo[];
};

export type ActivityActions = {
  loadPhotos: () => Promise<void>;
  updateActivity: (act: UpdatableActivity) => Promise<Activity>;
  setLoading: (x: boolean) => void;
  loadFromDB: (params: { ids?: number[] }) => Promise<number>;
  loadFromStrava: (params: {
    photos?: boolean;
    before?: number;
    ids?: number[];
  }) => Promise<number>;
};

export type ActivitySlice = ActivityState & ActivityActions;

const FeatureFromActivity = (act: Activity): Feature => {
  if (!act.map) throw new Error('No map data');
  const coordinates = decode(
    'polyline' in act.map
      ? act.map.polyline
      : (act.map as any).summary_polyline,
    5,
  ).map(([lat, lon]) => [lon, lat]);
  const feature: Feature = {
    type: 'Feature',
    id: Number(act.id),
    geometry: {
      type: 'LineString',
      coordinates:
        coordinates.length > 100
          ? geosimplify(coordinates, 20, 200)
          : coordinates,
    },
    properties: {
      id: Number(act.id),
      sport_type: act.sport_type,
    },
    bbox: act.map.bbox,
  };
  return feature;
};

export const createActivitySlice: StateCreator<
  RootState,
  [['zustand/immer', never]],
  [],
  ActivitySlice
> = (set, get) => ({
  // Initial state
  activityDict: {},
  geoJson: {
    type: 'FeatureCollection',
    features: [],
  },
  loading: false,
  loaded: false,
  photos: [],

  // Actions
  loadPhotos: async () => {
    const photos = await getPhotos();
    set((state) => {
      state.photos = photos;
    });
  },

  updateActivity: async (activity) => {
    try {
      set((state) => {
        state.loading = true;
      });
      const updatedActivity = await updateStravaActivity(activity);
      set((state) => {
        state.activityDict[updatedActivity.id] = updatedActivity;
        state.loading = false;
      });
      return updatedActivity;
    } catch (e) {
      set((state) => {
        state.loading = false;
      });
      throw new Error('Failed to update activity');
    }
  },

  setLoading: (x) =>
    set((state) => {
      state.loading = x;
    }),

  loadFromDB: async ({ ids }) => {
    set((state) => {
      state.loading = true;
    });
    try {
      if (!ids) {
        const activities = await getActivitiesPaged({
          pageSize: 500,
        });

        set((state) => {
          state.loading = false;
          state.loaded = true;
          activities.forEach((act) => {
            const activity = act as unknown as Activity;
            state.activityDict[activity.id] = activity;
            if (activity.map) {
              state.geoJson.features.push(FeatureFromActivity(activity));
            }
          });
        });
        return activities.length;
      } else {
        const activities = await getDBActivities({ ids });
        set((state) => {
          state.loading = false;
          state.loaded = true;
          activities.forEach((act) => {
            const activity = act as unknown as Activity;
            state.activityDict[activity.id] = activity;
            if (activity.map) {
              state.geoJson.features.push(FeatureFromActivity(activity));
            }
          });
        });
        return activities.length;
      }
    } catch (e) {
      set((state) => {
        state.loading = false;
      });
      throw new Error('Failed to fetch activities');
    }
  },

  loadFromStrava: async ({ photos, ids }) => {
    const account = get().account;
    if (!account) throw new Error('No account found');

    set((state) => {
      state.loading = true;
    });
    try {
      const { activities, photos: newPhotos } = await getStravaActivities({
        get_photos: photos,
        activities: ids?.map((id) => ({
          id,
          athlete: account.providerAccountId,
        })),
      });

      set((state) => {
        state.loading = false;
        state.loaded = true;
        activities.forEach((act) => {
          state.activityDict[act.id] = act;
          if (act.map) {
            state.geoJson.features.push(FeatureFromActivity(act));
          }
        });
        if (photos) {
          state.photos = [...state.photos, ...newPhotos];
        }
      });
      return activities.length;
    } catch (e) {
      set((state) => {
        state.loading = false;
      });
      throw new Error('Failed to fetch activities');
    }
  },
});
