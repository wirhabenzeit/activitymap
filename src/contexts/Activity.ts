import type {
  Activity,
  Photo,
  User,
  Account,
  Session,
} from "~/server/db/schema";
import type { StateCreator } from "zustand";
import { decode } from "@mapbox/polyline";
import type { TotalZustand } from "./Zustand";
import { type FeatureCollection, type Feature } from "geojson";

import * as geosimplify from "@mapbox/geosimplify-js";

import {
  getAccount,
  getActivities as getDBActivities,
  getActivitiesPaged,
  getPhotos,
} from "~/server/db/actions";
import {
  getActivities as getStravaActivities,
  updateActivity as updateStravaActivity,
} from "~/server/strava/actions";
import { type WritableDraft } from "immer";

const FeatureFromActivity = (act: Activity): Feature => {
  if (!act.map) throw new Error("No map data");
  const coordinates = decode(
    "polyline" in act.map ? act.map.polyline : act.map.summary_polyline,
    5,
  ).map(([lat, lon]) => [lon, lat]);
  const feature: Feature = {
    type: "Feature",
    id: Number(act.id),
    geometry: {
      type: "LineString",
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

export type ActivityZustand = {
  activityDict: Record<number, Activity>;
  geoJson: FeatureCollection;
  loading: boolean;
  loaded: boolean;
  photos: Photo[];
  user?: User;
  session?: Session;
  account?: Account;
  guest?: boolean;
  setGuest: (x: boolean) => void;
  setSession: (x: Session) => void;
  setUser: (user: User) => void;
  setAccount: (account: Account) => void;
  loadPhotos: () => Promise<void>;
  updateActivity: (act: Activity) => Promise<Activity>;
  setLoading: (x: boolean) => void;
  loadFromDB: ({
    ids,
    athleteId,
  }: {
    ids?: number[];
    athleteId?: number;
  }) => Promise<number>;
  loadFromStrava: ({
    photos,
    before,
    ids,
    athleteId,
  }: {
    photos?: boolean;
    before?: number;
    ids?: number[];
    athleteId?: number;
  }) => Promise<number>;
};

const setActivities =
  (acts: Activity[]) => (state: WritableDraft<TotalZustand>) => {
    state.loading = false;
    state.loaded = true;
    acts.forEach((act) => {
      state.activityDict[Number(act.id)] = {
        ...act,
        map: undefined,
      };
    });
    if (state.geoJson) {
      const features = state.geoJson.features;
      if (features) features.push(...acts.map(FeatureFromActivity));
    }
  };

export const activitySlice: StateCreator<
  TotalZustand,
  [["zustand/immer", never]],
  [],
  ActivityZustand
> = (set, get) => ({
  activityDict: {},
  photos: [],
  geoJson: {
    type: "FeatureCollection",
    features: [],
  },
  loading: true,
  loaded: false,
  guest: false,
  setGuest: (x: boolean) =>
    set((state) => {
      state.guest = x;
    }),
  loadPhotos: async () => {
    const photos = await getPhotos();
    set((state) => {
      state.photos = photos;
    });
  },
  setUser: (user: User) =>
    set((state) => {
      state.user = user;
    }),
  setAccount: (account: Account) =>
    set((state) => {
      state.account = account;
    }),
  setSession: (session: Session) =>
    set((state) => {
      state.session = session;
    }),
  setLoading: (x: boolean) => {
    set((state) => {
      state.loading = x;
    });
  },
  updateActivity: async (activity: Activity) => {
    const guest = get().guest;
    if (guest) {
      console.error("Guests cannot update activities");
      return activity;
    }
    try {
      const updatedActivity = await updateStravaActivity({
        name: activity.name,
        id: activity.id,
        description: activity.description,
        athlete: activity.athlete,
      });
      set((state) => {
        state.activityDict[Number(updatedActivity.id)] = updatedActivity;
      });
      return updatedActivity;
    } catch (e) {
      console.error(e);
      throw new Error("Failed to update activity");
    }
  },
  loadFromDB: async ({ ids, athleteId }) => {
    set((state) => {
      state.loading = true;
    });
    try {
      if (!ids) {
        const promises = await getActivitiesPaged({
          athlete_id: athleteId,
          pageSize: 500,
        });

        await Promise.all(
          promises.map((promise) =>
            Promise.resolve(promise)
              .then((data) => set(setActivities(data)))
              .catch(console.error),
          ),
        );

        return promises.length;
      } else {
        const acts = await getDBActivities({ ids });
        set(setActivities(acts));
        return acts.length;
      }
    } catch (e) {
      console.error(e);
      throw new Error("Failed to fetch activities");
    }
  },
  loadFromStrava: async ({ photos, before, ids, athleteId }) => {
    set((state) => {
      state.loading = true;
    });
    try {
      if (!athleteId) athleteId = (await getAccount({})).providerAccountId;
      if (athleteId != undefined) {
        const { activities: acts } = await getStravaActivities({
          get_photos: photos,
          before,
          activities: ids?.map((id) => ({
            id,
            athlete: athleteId!,
          })),
        });
        console.log(acts);
        set(setActivities(acts));
        return acts.length;
      }
      return 0;
    } catch (e) {
      console.error(e);
      throw new Error("Failed to fetch activities");
    }
  },
});
