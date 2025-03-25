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
};

export type ActivitySlice = ActivityState & ActivityActions;

const createFeature = (act: Activity): Feature<Geometry> => ({
  type: 'Feature',
  id: act.id,
  geometry: {
    type: 'LineString',
    coordinates:
      (act.map_polyline ?? act.map_summary_polyline)
        ? decode(act.map_polyline ?? act.map_summary_polyline!).map(
            ([lat, lon]) => [lon, lat],
          )
        : [],
  },
  properties: {
    id: act.id,
    sport_type: act.sport_type,
  },
  bbox:
    act.map_bbox && act.map_bbox.length === 4
      ? (act.map_bbox as [number, number, number, number])
      : undefined,
});

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
          (updatedActivity.map_polyline || updatedActivity.map_summary_polyline)
        ) {
          state.geoJson.features[featureIndex] = createFeature(updatedActivity);
        }
        state.loading = false;
      });
      return updatedActivity;
    } catch (e) {
      console.error('Error updating activity:', e);
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

  loadFromDB: async ({ ids, publicIds, userId }) => {
    const account = get().account;
    console.log('Starting loadFromDB:', {
      ids,
      publicIds,
      userId,
      hasAccount: !!account,
      accountDetails: account && {
        userId: account.userId,
        providerAccountId: account.providerAccountId,
      },
    });

    set((state) => {
      state.loading = true;
    });

    try {
      const activities: Activity[] = await getDBActivities({
        ids,
        public_ids: publicIds,
        user_id: userId,
      });

      console.log('DB activities fetch result:', {
        count: activities.length,
        firstActivity: activities[0]
          ? {
              id: activities[0].id,
              name: activities[0].name,
              athlete: activities[0].athlete,
            }
          : null,
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

      console.log('Store state updated with activities:', {
        activityCount: activities.length,
        featureCount: validActivities.length,
      });

      return activities.length;
    } catch (error) {
      console.error('Error loading activities from DB:', error);
      set((state) => {
        state.loading = false;
      });
      return 0;
    }
  },

  loadFromStrava: async ({ photos = false, ids, fetchNewest = false }) => {
    console.log('Starting loadFromStrava:', { photos, ids, fetchNewest });
    const account = get().account;
    if (!account) {
      console.error('No account found in store state');
      throw new Error('No account found');
    }
    console.log('Found account:', {
      providerAccountId: account.providerAccountId,
      hasAccessToken: !!account.access_token,
    });

    try {
      set((state) => {
        state.loading = true;
        console.log('Set loading state to true');
      });

      if (ids) {
        console.log('Loading specific activities by ID:', ids);
        // Case 1: Loading specific activities by ID
        const { activities, photos: newPhotos } = await fetchStravaActivities({
          accessToken: account.access_token!,
          activityIds: ids,
          includePhotos: photos,
          athleteId: parseInt(account.providerAccountId),
        });
        console.log(
          `Received ${activities.length} activities and ${newPhotos.length} photos from API`,
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
        console.log('Activity changes:', {
          new: newActivities.length,
          updated: updatedActivities.length,
        });

        set((state) => {
          console.log('Updating store state with new data');
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
            if (!existingActivity || activity.is_complete || !existingActivity.is_complete) {
              console.log(`Updating activity ${activity.id} in store (is_complete=${activity.is_complete})`);
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
              console.log(`Skipping update for complete activity ${activity.id}`);
            }
          });
          if (photos && newPhotos.length > 0) {
            // Deduplicate photos by unique_id
            const existingPhotoIds = new Set(state.photos.map(p => p.unique_id));
            const uniqueNewPhotos = newPhotos.filter(p => !existingPhotoIds.has(p.unique_id));
            
            console.log(`Adding ${uniqueNewPhotos.length} unique photos to store (filtered from ${newPhotos.length} total)`);
            state.photos = [...state.photos, ...uniqueNewPhotos];
          }
          state.loading = false;
          state.loaded = true;
          console.log('Store state updated successfully');
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
        console.log('Loading activities, fetchNewest:', fetchNewest);
        
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

          console.log('State for fetching older activities:', {
            hasActivities: activities.length > 0,
            oldestActivityDate: oldestActivity?.start_date,
            before,
          });
        } else {
          console.log('Fetching newest activities (no before parameter)');
        }

        // Fetch activities with or without the before parameter
        const result = await fetchStravaActivities({
          accessToken: account.access_token!,
          before: before,
          includePhotos: photos,
          athleteId: parseInt(account.providerAccountId),
        });

        console.log(
          `Received ${result.activities.length} activities and ${result.photos.length} photos from API`,
        );

        set((state) => {
          console.log('Updating store state with new data');
          result.activities.forEach((activity: Activity) => {
            // Check if we already have this activity and it's complete
            const existingActivity = state.activityDict[activity.id];
            
            // Only replace existing activity if:
            // 1. It doesn't exist, OR
            // 2. The new activity is complete, OR
            // 3. The existing activity is not complete
            if (!existingActivity || activity.is_complete || !existingActivity.is_complete) {
              console.log(`Updating activity ${activity.id} in store (is_complete=${activity.is_complete})`);
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
              console.log(`Skipping update for complete activity ${activity.id}`);
            }
          });
          if (photos && result.photos.length > 0) {
            // Deduplicate photos by unique_id
            const existingPhotoIds = new Set(state.photos.map(p => p.unique_id));
            const uniqueNewPhotos = result.photos.filter(p => !existingPhotoIds.has(p.unique_id));
            
            console.log(`Adding ${uniqueNewPhotos.length} unique photos to store (filtered from ${result.photos.length} total)`);
            state.photos = [...state.photos, ...uniqueNewPhotos];
          }
          state.loading = false;
          state.loaded = true;
          console.log('Store state updated successfully');
        });
        
        const activityType = fetchNewest ? 'newest' : 'older';
        get().addNotification({
          type: 'success',
          title: 'Activities loaded',
          message: `Successfully loaded ${result.activities.length} ${activityType} activities from Strava`,
        });
        return result.activities.length;
      }
    } catch (e) {
      console.error('Error in loadFromStrava:', e);
      set((state) => {
        state.loading = false;
        console.log('Set loading state to false due to error');
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
