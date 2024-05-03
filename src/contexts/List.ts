import {type StateCreator} from "zustand";
import {type TotalZustand} from "./Zustand";
import {listSettings} from "~/settings/list";
import type {
  GridSortItem,
  GridColumnVisibilityModel,
  GridSortModel,
} from "@mui/x-data-grid";

export type ListZustand = {
  compactList: {
    sortModel: GridSortItem[];
    columnVisibilityModel: GridColumnVisibilityModel;
  };
  fullList: {
    sortModel: GridSortItem[];
    columnVisibilityModel: GridColumnVisibilityModel;
  };
  setSortModel: (
    key: "compact" | "full",
    sortModel: GridSortModel
  ) => void;
  setColumnModel: (
    key: "compact" | "full",
    columnModel: GridColumnVisibilityModel
  ) => void;
};

export const listSlice: StateCreator<
  TotalZustand,
  [["zustand/immer", never]],
  [],
  ListZustand
> = (set) => ({
  compactList: listSettings.defaultState.compact,
  fullList: listSettings.defaultState.full,
  setSortModel: (key, sortModel) =>
    set((state) => {
      if (key == "compact")
        state.compactList.sortModel = sortModel;
      else state.fullList.sortModel = sortModel;
    }),
  setColumnModel: (key, columnModel) =>
    set((state) => {
      if (key == "compact")
        state.compactList.columnVisibilityModel =
          columnModel;
      else
        state.fullList.columnVisibilityModel = columnModel;
    }),
});
