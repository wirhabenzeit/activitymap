import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import type {
  Activity,
  Photo,
  User,
  Account,
  Session,
} from '~/server/db/schema';
import { type FeatureCollection, type Feature } from 'geojson';
import geosimplify from '@mapbox/geosimplify-js';
import { decode } from '@mapbox/polyline';
import {
  getAccount,
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
  user?: User;
  session?: Session;
  account?: Account;
  guest?: boolean;
};

export type ActivityActions = {
  setGuest: (x: boolean) => void;
  setSession: (x: Session) => void;
  setUser: (user: User) => void;
  setAccount: (account: Account) => void;
  loadPhotos: () => Promise<void>;
  updateActivity: (act: UpdatableActivity) => Promise<Activity>;
  setLoading: (x: boolean) => void;
  loadFromDB: (params: {
    ids?: number[];
    athleteId?: number;
  }) => Promise<number>;
  loadFromStrava: (params: {
    photos?: boolean;
    before?: number;
    ids?: number[];
    athleteId?: number;
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
  loading: true,
  loaded: false,
  photos: [],
  guest: false,

  // Actions
  setGuest: (x) =>
    set((state: RootState) => {
      state.guest = x;
    }),

  loadPhotos: async () => {
    const photos = await getPhotos();
    set((state: RootState) => {
      state.photos = photos;
    });
  },

  setUser: (user) =>
    set((state: RootState) => {
      state.user = user;
    }),

  setAccount: (account) =>
    set((state: RootState) => {
      state.account = account;
    }),

  setSession: (session) =>
    set((state: RootState) => {
      state.session = session;
    }),

  setLoading: (x) =>
    set((state: RootState) => {
      state.loading = x;
    }),

  updateActivity: async (activity) => {
    const guest = get().guest;
    if (guest) {
      console.error('Guests cannot update activities');
      throw new Error('Failed to update activity');
    }
    try {
      set((state: RootState) => {
        state.loading = true;
      });
      const updatedActivity: Activity = await updateStravaActivity(activity);
      set((state: RootState) => {
        state.activityDict[Number(updatedActivity.id)] = updatedActivity;
      });
      set((state: RootState) => {
        state.loading = false;
      });
      return updatedActivity;
    } catch (e) {
      console.error(e);
      set((state: RootState) => {
        state.loading = false;
      });
      throw new Error('Failed to update activity');
    }
  },

  loadFromDB: async ({ ids, athleteId }) => {
    set((state: RootState) => {
      state.loading = true;
    });
    try {
      if (!ids) {
        const promises = await getActivitiesPaged({
          athlete_id: athleteId,
          pageSize: 500,
        });

        if (promises.length === 0) {
          try {
            const athleteId = (await getAccount({})).providerAccountId;
            if (athleteId !== undefined) {
              const { activities: acts } = await getStravaActivities({
                get_photos: false,
              });
              set((state: RootState) => {
                state.loading = false;
                state.loaded = true;
                acts.forEach((act) => {
                  state.activityDict[act.id] = act;
                });
                if (state.geoJson.features) {
                  state.geoJson.features.push(...acts.map(FeatureFromActivity));
                }
              });
            }
          } catch (e) {
            console.error(e);
            throw new Error('Failed to fetch activities');
          }
        } else {
          await Promise.all(
            promises.map((promise) =>
              Promise.resolve(promise)
                .then((acts) =>
                  set((state: RootState) => {
                    state.loading = false;
                    state.loaded = true;
                    acts.forEach((act) => {
                      state.activityDict[act.id] = act;
                    });
                    if (state.geoJson.features) {
                      state.geoJson.features.push(
                        ...acts.map(FeatureFromActivity),
                      );
                    }
                  }),
                )
                .catch(console.error),
            ),
          );
        }
        return promises.length;
      } else {
        const acts = await getDBActivities({ ids });
        set((state: RootState) => {
          state.loading = false;
          state.loaded = true;
          acts.forEach((act) => {
            state.activityDict[act.id] = act;
          });
          if (state.geoJson.features) {
            state.geoJson.features.push(...acts.map(FeatureFromActivity));
          }
        });
        return acts.length;
      }
    } catch (e) {
      console.error(e);
      throw new Error('Failed to fetch activities');
    }
  },

  loadFromStrava: async ({ photos, ids }) => {
    set((state: RootState) => {
      state.loading = true;
    });
    try {
      const athleteId = (await getAccount({})).providerAccountId;
      if (athleteId !== undefined) {
        const { activities: acts, photos: phts } = await getStravaActivities({
          get_photos: photos,
          activities: ids?.map((id) => ({
            id,
            athlete: athleteId,
          })),
        });
        set((state: RootState) => {
          state.loading = false;
          state.loaded = true;
          acts.forEach((act) => {
            state.activityDict[act.id] = act;
          });
          if (state.geoJson.features) {
            state.geoJson.features.push(...acts.map(FeatureFromActivity));
          }
          state.photos = [...state.photos, ...phts];
        });
        return acts.length;
      }
      return 0;
    } catch (e) {
      console.error(e);
      throw new Error('Failed to fetch activities');
    }
  },
});
