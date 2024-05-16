import {create} from "zustand";
import {immer} from "zustand/middleware/immer";
import {subscribeWithSelector} from "zustand/middleware";

import {
  activitySlice,
  type ActivityZustand,
} from "./Activity";
import {uiSlice, type UIZustand} from "./UI";
import {filterSlice, type FilterZustand} from "./Filter";
import {
  selectionSlice,
  type SelectionZustand,
} from "./Selection";
import {statsSlice, type StatsZustand} from "./Stats";
import {listSlice, type ListZustand} from "./List";
import {mapSlice, type MapZustand} from "./Map";

export type TotalZustand = ActivityZustand &
  UIZustand &
  FilterZustand &
  SelectionZustand &
  StatsZustand &
  ListZustand &
  MapZustand;

export const useStore = create<TotalZustand>()(
  immer(
    subscribeWithSelector((...a) => ({
      ...activitySlice(...a),
      ...uiSlice(...a),
      ...filterSlice(...a),
      ...selectionSlice(...a),
      ...statsSlice(...a),
      ...listSlice(...a),
      ...mapSlice(...a),
    }))
  )
);

/*useStore.subscribe(
  (state) => state.activityDict,
  (activityDict) => {
    console.log("activityDict changed", activityDict);
    useStore.setState((state) => state.updateFilters());
  },
  {fireImmediately: true}
);*/

/*useStore.subscribe((state, prevState) => {
  return;
});*/
