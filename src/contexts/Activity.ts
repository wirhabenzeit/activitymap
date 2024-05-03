import {type Activity} from "~/server/db/schema";
import {type StateCreator} from "zustand";
import {decode} from "@mapbox/polyline";
import {type TotalZustand} from "./Zustand";
import {
  type FeatureCollection,
  type Feature,
} from "geojson";

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
  setLoading: (x: boolean) => void;
  loadFromDB: () => Promise<void>;
  loadFromStrava: ({
    photos,
    before,
  }: {
    photos?: boolean;
    before?: number;
  }) => Promise<number>;
};

export const activitySlice: StateCreator<
  TotalZustand,
  [["zustand/immer", never]],
  [],
  ActivityZustand
> = (set) => ({
  activityDict: {},
  geoJson: {
    type: "FeatureCollection",
    features: [],
  },
  loading: true,
  loaded: false,
  setLoading: (x: boolean) => {
    set((state) => {
      state.loading = x;
    });
  },
  loadFromDB: async () => {
    const res = await fetch("/api/db");
    const data = (await res.json()) as Activity[];
    return set((state) => {
      state.loading = false;
      state.loaded = true;
      if (state.geoJson) {
        const features = state.geoJson.features;
        if (features)
          features.push(...data.map(FeatureFromActivity));
      }
      data.forEach((act) => {
        state.activityDict[Number(act.id)] = act;
      });
    });
  },
  loadFromStrava: async ({photos, before}) => {
    set((state) => {
      state.loading = true;
    });
    const params = new URLSearchParams(
      Object.fromEntries(
        Object.entries({
          photos,
          before,
          page: 1,
        }).filter(([, v]) => v !== undefined)
      )
    );
    const res = await fetch(
      `/api/strava/activities?${params.toString()}`
    );
    const data = (await res.json()) as Activity[];
    set((state) => {
      state.loading = false;
      state.loaded = true;
      state.geoJson.features.push(
        ...data.map(FeatureFromActivity)
      );
      data.forEach((act) => {
        state.activityDict[Number(act.id)] = act;
      });
    });
    return data.length;
  },
});
