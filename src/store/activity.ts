import { type StateCreator } from 'zustand';

import { type RootState } from './index';
import type { Activity, Photo } from '~/server/db/schema';
import { type FeatureCollection, type Feature, type Geometry } from 'geojson';
import { decode } from '@mapbox/polyline';
import {
  getActivities as getDBActivities,
  getPhotos,
} from '~/server/db/actions';
import {
  fetchStravaActivities,
  updateActivity as updateStravaActivity,
  deleteActivities as deleteServerActivities,
} from '~/server/strava/actions';
import { type UpdatableActivity } from '~/server/strava/types';

export type ActivityState = {
  activityDict: Record<number, Activity>;
  geoJson: FeatureCollection;
  loading: boolean;
  loaded: boolean;
  photos: Photo[];
  photoDict: Record<string, Photo>;
  error: string | null;
  // Batched loading state
  batchOffset?: number;
  batchSize?: number;
  batchTimer?: ReturnType<typeof setTimeout> | null;
};

export type ActivityActions = {
  loadPhotos: () => Promise<void>;
  updateActivity: (act: UpdatableActivity) => Promise<Activity>;
  setLoading: (x: boolean) => void;
  loadFromDB: (params: {
    ids?: number[];
    publicIds?: number[];
    userId?: string;
  }) => Promise<number>;
  loadFromStrava: (params: {
    photos?: boolean;
    ids?: number[];
    fetchNewest?: boolean;
  }) => Promise<number>;
  // Batched loading actions
  loadFromDBBatched: (params: { userId?: string }) => Promise<void>;
  cancelBatchLoading: () => void;
};

export type ActivitySlice = ActivityState & ActivityActions;

const createFeature = (act: Activity): Feature<Geometry> => ({
  type: 'Feature',
  id: act.id,
  geometry: {
    type: 'LineString',
    coordinates:
      (act.map_polyline ?? act.map_summary_polyline)
        ? decode(act.map_summary_polyline!).map(
          ([lat, lon]) => [lon, lat],
        )
        : [],
  },
  properties: {
    id: act.id,
    sport_type: act.sport_type,
  },
  bbox:
    act.map_bbox?.length === 4
      ? (act.map_bbox as [number, number, number, number])
      : undefined,
});

export const createActivitySlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  ActivitySlice
> = (set, get, store) => {
  store.subscribe((state, prevState) => {
    if (state.loading !== prevState.loading) {

    }
  });
  return {
    // Initial state
    activityDict: {},
    geoJson: {
      type: 'FeatureCollection',
      features: [],
    },
    loading: false,
    loaded: false,
    photos: [],
    photoDict: {},
    error: null,
    // Batched loading state
    batchOffset: 0,
    batchSize: 500,
    batchTimer: null,

    // Actions
    loadPhotos: async () => {
      try {
        const photos = await getPhotos();

        set((state) => {
          const photoDict = photos.reduce<
            Record<string, Photo>
          >((acc, photo) => {
            acc[photo.unique_id] = photo;
            return acc;
          }, {});

          state.photos = photos;
          state.photoDict = photoDict;
        });
      } catch (e) {
        console.error('Error loading photos:', e);
      }
    },

    updateActivity: async (activity) => {
      try {
        set((state) => {
          state.loading = true;
        });

        // Get account from store state
        const account = get().account;
        if (!account) {
          throw new Error('No account found in store state');
        }

        // Pass account information directly to the server action
        const updatedActivity = await updateStravaActivity(activity, {
          access_token: account.access_token!,
          providerAccountId: account.providerAccountId,
        });

        if (!updatedActivity) throw new Error('Failed to update activity');

        set((state) => {
          state.activityDict[updatedActivity.id] = updatedActivity;
          // Update the GeoJSON feature if it exists
          const featureIndex = state.geoJson.features.findIndex(
            (f) => f.id === updatedActivity.id,
          );
          if (
            featureIndex !== -1 &&
            (updatedActivity.map_polyline ||
              updatedActivity.map_summary_polyline)
          ) {
            state.geoJson.features[featureIndex] =
              createFeature(updatedActivity);
          }
          state.loading = false;
        });
        return updatedActivity;
      } catch (e) {
        console.error('Error updating activity:', e);
        set((state) => {
          state.loading = false;
          state.error = e instanceof Error ? e.message : String(e);
        });
        throw new Error('Failed to update activity');
      }
    },

    setLoading: (x) =>
      set((state) => {
        state.loading = x;
      }),

    loadFromDB: async ({ ids, publicIds, userId }) => {

      const account = get().account;


      set((state) => {
        state.loading = true;
      });

      try {
        const activities: Activity[] = await getDBActivities({
          ids,
          public_ids: publicIds,
          user_id: userId,
        });



        const validActivities = activities.filter(
          (act) => act.map_polyline ?? act.map_summary_polyline,
        );

        set((state) => {
          state.geoJson = {
            type: 'FeatureCollection',
            features: validActivities.map(createFeature),
          };
          state.loading = false;
          state.loaded = true;
          state.activityDict = Object.fromEntries(
            activities.map((act) => [act.id, act]),
          );
        });

        // Explicitly update filterIDs
        get().updateFilterIDs();


        await get().loadPhotos();


        return activities.length;
      } catch (error) {
        console.error('Error loading activities from DB:', error);
        set((state) => {
          state.loading = false;
          state.error = error instanceof Error ? error.message : String(error);
        });
        return 0;
      }
    },

    loadFromStrava: async ({ photos = false, ids, fetchNewest = false }) => {

      const account = get().account;
      if (!account) {
        console.error('No account found in store state');
        throw new Error('No account found');
      }


      try {
        set((state) => {
          state.loading = true;

        });

        if (ids) {

          // Case 1: Loading specific activities by ID
          const {
            activities,
            photos: newPhotos,
            notFoundIds,
          } = await fetchStravaActivities({
            accessToken: account.access_token!,
            activityIds: ids,
            includePhotos: photos,
            athleteId: parseInt(account.providerAccountId),
          });


          // If activities were not found, delete them from DB and update local state
          if (notFoundIds && notFoundIds.length > 0) {

            // Call server action to delete from DB (fire-and-forget for now, errors logged server-side)
            const { deletedIds } = await deleteActivitiesInStore(notFoundIds);

            // Update local state immediately
            set((state) => {
              // Remove from activityDict
              deletedIds.forEach((id: number) => {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete state.activityDict[id];
              });
              // Remove from geoJson
              state.geoJson.features = state.geoJson.features.filter(
                (feature) => !deletedIds.includes(feature.id as number),
              );

            });
            // Since we handled the state update for deletion, we can return early
            return deletedIds.length; // Indicate how many were removed
          }

          // Check which activities are new vs updated
          const existingIds = Object.keys(get().activityDict).map(Number);
          const newActivities = activities.filter(
            (act) => !existingIds.includes(act.id),
          );
          const updatedActivities = activities.filter((act) =>
            existingIds.includes(act.id),
          );


          set((state) => {

            // Remove old photos for these activities
            state.photos = state.photos.filter(
              (photo) => !ids.includes(photo.activity_id),
            );

            activities.forEach((activity: Activity) => {
              // Check if we already have this activity and it's complete
              const existingActivity = state.activityDict[activity.id];

              // Only replace existing activity if:
              // 1. It doesn't exist, OR
              // 2. The new activity is complete, OR
              // 3. The existing activity is not complete
              if (
                !existingActivity ||
                activity.is_complete ||
                !existingActivity.is_complete
              ) {

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
                    state.geoJson.features.push(createFeature(activity));
                  } catch (e) {
                    console.warn(
                      `Failed to create feature for activity ${activity.id}:`,
                      e,
                    );
                  }
                }
              } else {

              }
            });
            if (photos && newPhotos.length > 0) {
              // Deduplicate photos by unique_id
              const existingPhotoIds = new Set(
                state.photos.map((p) => p.unique_id),
              );
              const uniqueNewPhotos = newPhotos.filter(
                (p) => !existingPhotoIds.has(p.unique_id),
              );


              state.photos = [...state.photos, ...uniqueNewPhotos];
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

          await get().loadPhotos();

          return activities.length;
        } else {


          let before: number | undefined = undefined;

          // Only calculate the 'before' timestamp if we're fetching older activities
          if (!fetchNewest) {
            // Find oldest activity from current state
            const activities = Object.values(get().activityDict);
            const oldestActivity =
              activities.length > 0
                ? activities.reduce((oldest, current) =>
                  current.start_date < oldest.start_date ? current : oldest,
                )
                : null;

            before = oldestActivity
              ? Math.floor(oldestActivity.start_date.getTime() / 1000)
              : Math.floor(Date.now() / 1000);


          } else {

          }

          // Fetch activities with or without the before parameter
          const result = await fetchStravaActivities({
            accessToken: account.access_token!,
            before: before,
            includePhotos: photos,
            athleteId: parseInt(account.providerAccountId),
          });



          set((state) => {

            result.activities.forEach((activity: Activity) => {
              // Check if we already have this activity and it's complete
              const existingActivity = state.activityDict[activity.id];

              // Only replace existing activity if:
              // 1. It doesn't exist, OR
              // 2. The new activity is complete, OR
              // 3. The existing activity is not complete
              if (
                !existingActivity ||
                activity.is_complete ||
                !existingActivity.is_complete
              ) {

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
                    state.geoJson.features.push(createFeature(activity));
                  } catch (e) {
                    console.warn(
                      `Failed to create feature for activity ${activity.id}:`,
                      e,
                    );
                  }
                }
              } else {

              }
            });
            if (photos && result.photos.length > 0) {
              // Deduplicate photos by unique_id
              const existingPhotoIds = new Set(
                state.photos.map((p) => p.unique_id),
              );
              const uniqueNewPhotos = result.photos.filter(
                (p) => !existingPhotoIds.has(p.unique_id),
              );


              state.photos = [...state.photos, ...uniqueNewPhotos];
            }
            state.loading = false;
            state.loaded = true;

          });

          const activityType = fetchNewest ? 'newest' : 'older';
          get().addNotification({
            type: 'success',
            title: 'Activities loaded',
            message: `Successfully loaded ${result.activities.length} ${activityType} activities from Strava`,
          });

          await get().loadPhotos();

          return result.activities.length;
        }
      } catch (e) {
        console.error('Error in loadFromStrava:', e);
        set((state) => {
          state.loading = false;
          state.error = e instanceof Error ? e.message : String(e);

        });
        // Ensure error is re-thrown or handled if needed by caller
        throw e;
      }
    },

    // Batched loading implementation
    loadFromDBBatched: async ({ userId }) => {
      // Cancel any previous batch
      get().cancelBatchLoading();
      set((state) => {
        state.batchOffset = 0;
        state.loading = true;
        state.loaded = false;
        state.error = null;
        state.activityDict = {};
        state.geoJson = { type: 'FeatureCollection', features: [] };
      });
      const batchSize = get().batchSize ?? 500;
      let offset = 0;
      const fetchBatch = async () => {
        if (!get().loading) return;
        try {
          const activities: Activity[] = await getDBActivities({
            user_id: userId,
            limit: batchSize,
            offset,
          });
          const validActivities = activities.filter(
            (act) => act.map_polyline ?? act.map_summary_polyline,
          );
          set((state) => {
            // Append to activityDict
            for (const act of activities) {
              state.activityDict[act.id] = act;
            }
            // Append to geoJson
            state.geoJson.features.push(...validActivities.map(createFeature));
          });
          // Update filterIDs if available
          if (get().updateFilterIDs) get().updateFilterIDs();
          // Optionally load photos for new activities (optional, can be removed)
          if (offset === 0) {
            void (async () => { await get().loadPhotos(); })();
          }
          // If fewer than batchSize, we're done
          if (activities.length < batchSize) {
            set((state) => {
              state.loading = false;
              state.loaded = true;
              state.batchTimer = null;
            });
            return;
          }
          // Otherwise, schedule next batch
          offset += batchSize;
          set((state) => { state.batchOffset = offset; });
          const timer = setTimeout(() => { void fetchBatch(); }, 2000);
          set((state) => { state.batchTimer = timer; });
        } catch (error) {
          set((state) => {
            state.loading = false;
            state.loaded = false;
            state.error = error instanceof Error ? error.message : String(error);
            state.batchTimer = null;
          });
        }
      };
      void fetchBatch();
    },

    cancelBatchLoading: () => {
      const timer = get().batchTimer;
      if (timer) clearTimeout(timer);
      set((state) => {
        state.loading = false;
        state.loaded = false;
        state.batchTimer = null;
      });
    },
  };
};

export const serverActions = {
  fetchStravaActivities,
  deleteServerActivities,
  updateStravaActivity,
};

const deleteActivitiesInStore = async (
  activityIds: number[],
): Promise<{ deletedIds: number[] }> => {
  try {
    await deleteServerActivities(activityIds);

    // Remove features from GeoJSON
    // Return the IDs that were requested for deletion, matching the expected return type.
    return { deletedIds: activityIds };
  } catch (e) {
    console.error('Error deleting activities:', e);
    throw e;
  }
};
