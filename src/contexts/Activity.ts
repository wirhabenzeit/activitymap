import type {Account, Activity} from "~/server/db/schema";
import type {StateCreator} from "zustand";
import {decode} from "@mapbox/polyline";
import type {TotalZustand} from "./Zustand";
import {
  type FeatureCollection,
  type Feature,
} from "geojson";

import {getActivities as getDBActivities} from "~/server/db/actions";
import {
  UpdatableActivity,
  getActivities as getStravaActivities,
  updateActivity as updateStravaActivity,
} from "~/server/strava/actions";
import {WritableDraft} from "immer";

const FeatureFromActivity = (act: Activity): Feature => {
  if (!act.map) throw new Error("No map data");
  const feature: Feature = {
    type: "Feature",
    id: Number(act.id),
    geometry: {
      type: "LineString",
      coordinates: decode(act.map.summary_polyline).map(
        ([lat, lon]) => [lon, lat]
      ),
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
  account?: Account;
  setAccount: (acc: Account) => void;
  updateActivity: (act: Activity) => Promise<Activity>;
  setLoading: (x: boolean) => void;
  loadFromDB: () => Promise<void>;
  loadFromStrava: ({
    photos,
    before,
    ids,
  }: {
    photos?: boolean;
    before?: number;
    ids?: number[];
  }) => Promise<number>;
};

const setActivities =
  (acts: Activity[]) =>
  (state: WritableDraft<TotalZustand>) => {
    state.loading = false;
    state.loaded = true;
    acts.forEach((act) => {
      state.activityDict[Number(act.id)] = act;
    });
    if (state.geoJson) {
      const features = state.geoJson.features;
      if (features)
        features.push(...acts.map(FeatureFromActivity));
    }
  };

export const activitySlice: StateCreator<
  TotalZustand,
  [["zustand/immer", never]],
  [],
  ActivityZustand
> = (set, get) => ({
  activityDict: {},
  geoJson: {
    type: "FeatureCollection",
    features: [],
  },
  loading: true,
  loaded: false,
  setAccount: (account: Account) =>
    set((state) => {
      state.account = account;
    }),
  setLoading: (x: boolean) => {
    set((state) => {
      state.loading = x;
    });
  },
  updateActivity: async (activity: UpdatableActivity) => {
    try {
      const athlete = get().account;
      const updatedActivity = await updateStravaActivity(
        activity,
        {
          access_token: athlete?.access_token
            ? athlete?.access_token
            : undefined,
        }
      );
      set((state) => {
        state.activityDict[Number(updatedActivity.id)] =
          updatedActivity;
      });
      return updatedActivity;
    } catch (e) {
      console.error(e);
      throw new Error("Failed to update activity");
    }
  },
  loadFromDB: async () => {
    set((state) => {
      state.loading = true;
    });
    try {
      const athlete = get().account;
      const acts = await getDBActivities({
        athlete_id: athlete?.providerAccountId,
      });
      set(setActivities(acts));
    } catch (e) {
      console.error(e);
      throw new Error("Failed to fetch activities");
    }
  },
  loadFromStrava: async ({photos, before, ids}) => {
    set((state) => {
      state.loading = true;
    });
    try {
      const athlete = get().account;
      const {activities: acts} = await getStravaActivities({
        get_photos: photos,
        before,
        ids,
        access_token: athlete?.access_token
          ? athlete?.access_token
          : undefined,
        athlete_id: athlete?.providerAccountId,
      });
      set(setActivities(acts));
      return acts.length;
    } catch (e) {
      console.error(e);
      throw new Error("Failed to fetch activities");
    }
  },
});
