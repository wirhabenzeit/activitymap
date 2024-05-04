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
  updateActivity: async (act: Activity) => {
    try {
      const res = await fetch("/api/strava/update", {
        method: "POST",
        body: JSON.stringify({
          id: act.id,
          name: act.name,
          description: act.description,
        }),
      });
      const json = await res.json();
      set((state) => {
        state.activityDict[Number(act.id)].name = json.name;
        state.activityDict[Number(act.id)].description =
          json.description;
      });
      return json;
    } catch (e) {
      console.error(e);
      throw new Error("Failed to update activity");
    }
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
  loadFromStrava: async ({photos, before, ids}) => {
    set((state) => {
      state.loading = true;
    });
    const params = new URLSearchParams(
      Object.fromEntries(
        Object.entries({
          photos,
          before,
          ids: ids?.join(","),
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
