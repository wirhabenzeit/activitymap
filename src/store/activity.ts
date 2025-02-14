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
  fetchActivitiesByIds,
  fetchActivitiesBeforeTimestamp,
  updateActivity as updateStravaActivity,
} from '~/server/strava/actions';
import { type UpdatableActivity } from '~/server/strava/types';

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
    ids?: number[];
  }) => Promise<number>;
};

export type ActivitySlice = ActivityState & ActivityActions;

const FeatureFromActivity = (act: Activity): Feature => {
  if (!act.map_polyline && !act.map_summary_polyline)
    throw new Error('No polyline data');
  const polyline = act.map_polyline || act.map_summary_polyline;
  if (!polyline) throw new Error('No polyline data');

  const coordinates = decode(polyline).map(([lat, lon]) => [lon, lat]);
  return {
    type: 'Feature',
    id: act.id,
    geometry: {
      type: 'LineString',
      coordinates:
        coordinates.length > 100
          ? geosimplify(coordinates, 20, 200)
          : coordinates,
    },
    properties: {
      id: act.id,
      sport_type: act.sport_type,
    },
    bbox:
      act.map_bbox && act.map_bbox.length === 4
        ? (act.map_bbox as [number, number, number, number])
        : undefined,
  };
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
      if (!updatedActivity) throw new Error('Failed to update activity');

      set((state) => {
        state.activityDict[updatedActivity.id] = updatedActivity;
        // Update the GeoJSON feature if it exists
        const featureIndex = state.geoJson.features.findIndex(
          (f) => f.id === updatedActivity.id,
        );
        if (
          featureIndex !== -1 &&
          (updatedActivity.map_polyline || updatedActivity.map_summary_polyline)
        ) {
          state.geoJson.features[featureIndex] =
            FeatureFromActivity(updatedActivity);
        }
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
      const activities = ids
        ? await getDBActivities({ ids })
        : await getActivitiesPaged({ pageSize: 500 });

      set((state) => {
        state.loading = false;
        state.loaded = true;
        activities.forEach((activity) => {
          state.activityDict[activity.id] = activity;
          if (activity.map_polyline || activity.map_summary_polyline) {
            try {
              state.geoJson.features.push(FeatureFromActivity(activity));
            } catch (e) {
              console.warn(
                `Failed to create feature for activity ${activity.id}:`,
                e,
              );
            }
          }
        });
      });
      return activities.length;
    } catch (e) {
      set((state) => {
        state.loading = false;
      });
      throw new Error('Failed to fetch activities');
    }
  },

  loadFromStrava: async ({ photos = false, ids }) => {
    const account = get().account;
    if (!account) throw new Error('No account found');

    try {
      set((state) => {
        state.loading = true;
      });

      if (ids) {
        // Case 1: Loading specific activities by ID
        const { activities, photos: newPhotos } = await fetchActivitiesByIds(
          ids,
          photos,
        );

        // Check which activities are new vs updated
        const existingActivities = new Set(
          Object.keys(get().activityDict).map(Number),
        );
        const newActivities = activities.filter(
          (act) => !existingActivities.has(act.id),
        );
        const updatedActivities = activities.filter((act) =>
          existingActivities.has(act.id),
        );

        set((state) => {
          // Remove old photos for these activities
          state.photos = state.photos.filter(
            (photo) => !ids.includes(photo.activity_id!),
          );

          activities.forEach((activity: Activity) => {
            state.activityDict[activity.id] = activity;
            if (activity.map_polyline || activity.map_summary_polyline) {
              try {
                // Remove existing feature if it exists
                const featureIndex = state.geoJson.features.findIndex(
                  (f) => f.id === activity.id,
                );
                if (featureIndex !== -1) {
                  state.geoJson.features.splice(featureIndex, 1);
                }
                state.geoJson.features.push(FeatureFromActivity(activity));
              } catch (e) {
                console.warn(
                  `Failed to create feature for activity ${activity.id}:`,
                  e,
                );
              }
            }
          });
          if (photos && newPhotos.length > 0) {
            state.photos = [...state.photos, ...newPhotos];
          }
          state.loading = false;
          state.loaded = true;
        });

        // Create appropriate notification based on whether activities were new or updated
        if (activities.length === 1) {
          const activity = activities[0]!;
          const isNew = newActivities.length === 1;
          get().addNotification({
            type: 'success',
            title: activity.name,
            message: isNew
              ? 'Activity added from Strava'
              : 'Activity updated from Strava',
          });
        } else {
          get().addNotification({
            type: 'success',
            title: 'Activities loaded',
            message: `${newActivities.length} activities added, ${updatedActivities.length} updated from Strava`,
          });
        }
        return activities.length;
      } else {
        // Case 2: Loading older activities
        // Find oldest activity from current state
        const activities = Object.values(get().activityDict);
        const oldestActivity =
          activities.length > 0
            ? activities.reduce((oldest, current) =>
                current.start_date < oldest.start_date ? current : oldest,
              )
            : null;

        const timestamp = oldestActivity
          ? Math.floor(oldestActivity.start_date.getTime() / 1000)
          : undefined;

        if (!timestamp) {
          return 0;
        }

        const result = await fetchActivitiesBeforeTimestamp(timestamp, photos);
        set((state) => {
          result.activities.forEach((activity: Activity) => {
            state.activityDict[activity.id] = activity;
            if (activity.map_polyline || activity.map_summary_polyline) {
              try {
                // Remove existing feature if it exists
                const featureIndex = state.geoJson.features.findIndex(
                  (f) => f.id === activity.id,
                );
                if (featureIndex !== -1) {
                  state.geoJson.features.splice(featureIndex, 1);
                }
                state.geoJson.features.push(FeatureFromActivity(activity));
              } catch (e) {
                console.warn(
                  `Failed to create feature for activity ${activity.id}:`,
                  e,
                );
              }
            }
          });
          if (photos && result.photos.length > 0) {
            state.photos = [...state.photos, ...result.photos];
          }
          state.loading = false;
          state.loaded = true;
        });
        get().addNotification({
          type: 'success',
          title: 'Activities loaded',
          message: `Successfully loaded ${result.activities.length} activities from Strava`,
        });
        return result.activities.length;
      }
    } catch (e) {
      set((state) => {
        state.loading = false;
      });
      get().addNotification({
        type: 'error',
        title: 'Error loading activities',
        message: e instanceof Error ? e.message : 'An unknown error occurred',
      });
      throw new Error('Failed to fetch activities from Strava');
    }
  },
});
