import { useContext, createContext, useState, useEffect } from "react";
import { categorySettings, filterSettings, binaryFilters } from "@/settings";
import { ActivityContext } from "./ActivityContext";

const filterState = {
  categories: {},
  values: {},
  search: "",
  binary: {},
  filterRanges: {},
  filterIDs: [],
  selected: [],
  highlighted: 0,
};

Object.entries(categorySettings).forEach(([key, category]) => {
  filterState.categories[key] = {
    active: category.active,
    filter: category.active ? category.alias : [],
  };
});

Object.entries(filterSettings).forEach(([key, filter]) => {
  filterState.values[key] = [undefined, undefined];
  filterState.filterRanges[key] = [undefined, undefined];
});

Object.entries(binaryFilters).forEach(([key, filter]) => {
  filterState.binary[key] = filter.defaultValue;
});

const FilterContext = createContext(filterState);

export function FilterContextProvider({ children }) {
  const [state, setState] = useState(filterState);
  const activityContext = useContext(ActivityContext);

  console.log("FilterContextProvider render");

  useEffect(() => {
    if (activityContext.athlete !== undefined) {
      console.log("Setting Filter Ranges");
      setFilterRanges();
    }
  }, [activityContext]);

  const setStateCustom = (fn) => {
    setState((prev) => {
      const newState = fn(prev);
      return {
        ...newState,
        filterIDs: Object.entries(activityContext.activityDict)
          .filter(([key, value]) => filterFn(value, newState))
          .map(([key, value]) => Number(key)),
      };
    });
  };

  const setFilterRanges = () => {
    setStateCustom((prev) => ({
      ...prev,
      filterRanges: Object.entries(filterSettings)
        .map(([key, value]) => [
          key,
          [
            Math.min(
              ...Object.values(activityContext.activityDict).map(
                (feature) => feature.properties[key]
              )
            ),
            Math.max(
              ...Object.values(activityContext.activityDict).map(
                (feature) => feature.properties[key]
              )
            ),
          ],
        ])
        .reduce((obj, [key, value]) => ((obj[key] = value), obj), {}),
    }));
  };

  const setSelected = (selected) => {
    console.log("setSelected", selected);
    setStateCustom((filter) => ({
      ...filter,
      selected: selected,
      highlighted: 0,
    }));
  };

  const setHighlighted = (highlighted) => {
    setStateCustom((filter) => ({
      ...filter,
      highlighted: highlighted,
    }));
  };

  const setOnlyCategory = (selectedID) => {
    setStateCustom((filter) => {
      if (
        filter.categories[selectedID].active &&
        Object.values(filter.categories).filter((category) => category.active)
          .length === 1
      ) {
        return {
          ...filter,
          categories: Object.entries(filter.categories).reduce(
            (acc, [key, value]) => {
              acc[key] = {
                active: true,
                filter: categorySettings[key].alias,
              };
              return acc;
            },
            {}
          ),
        };
      }
      return {
        ...filter,
        categories: Object.entries(filter.categories).reduce(
          (acc, [key, value]) => {
            acc[key] = {
              active: key === selectedID,
              filter: key === selectedID ? categorySettings[key].alias : [],
            };
            return acc;
          },
          {}
        ),
      };
    });
  };

  const toggleCategory = (selectedID) => {
    if (state.categories[selectedID].active) {
      setStateCustom((filter) => ({
        ...filter,
        categories: {
          ...filter.categories,
          [selectedID]: {
            ...filter.categories[selectedID],
            active: !filter.categories[selectedID].active,
            filter: [],
          },
        },
      }));
    } else {
      setStateCustom((filter) => ({
        ...filter,
        categories: {
          ...filter.categories,
          [selectedID]: {
            ...filter.categories[selectedID],
            active: !filter.categories[selectedID].active,
            filter: categorySettings[selectedID].alias,
          },
        },
      }));
    }
  };

  const updateValueFilter = (selectedID, newFilter) => {
    if (newFilter.length > 0) {
      setStateCustom((filter) => ({
        ...filter,
        values: { ...filter.values, [selectedID]: newFilter },
      }));
    } else {
      setStateCustom((filter) => ({
        ...filter,
        values: { ...filter.values, [selectedID]: [undefined, undefined] },
      }));
    }
  };

  const setSearch = (newSearch) => {
    setStateCustom((filter) => ({
      ...filter,
      search: newSearch,
    }));
  };

  const setBinary = (selectedID, newValue) => {
    console.log("setBinary", selectedID, newValue);
    setStateCustom((filter) => ({
      ...filter,
      binary: { ...filter.binary, [selectedID]: newValue },
    }));
  };

  const updateCategoryFilter = (selectedID, newFilter) => {
    if (newFilter.length > 0) {
      setStateCustom((filter) => ({
        ...filter,
        categories: {
          ...filter.categories,
          [selectedID]: {
            ...filter.categories[selectedID],
            filter: newFilter,
            active: true,
          },
        },
      }));
    } else {
      setStateCustom((filter) => ({
        ...filter,
        categories: {
          ...filter.categories,
          [selectedID]: {
            ...filter.categories[selectedID],
            filter: [],
            active: false,
          },
        },
      }));
    }
  };

  const filterFn = (data, state) => {
    const activeCat = [];
    Object.entries(state.categories).forEach(([key, value]) => {
      activeCat.push(...value.filter);
    });
    if (!activeCat.includes(data.properties.sport_type)) return false;
    if (
      state.search &&
      !data.properties.name.toLowerCase().includes(state.search.toLowerCase())
    )
      return false;
    if (
      Object.entries(state.values).some(
        ([key, value]) =>
          data.properties[key] < value[0] || data.properties[key] > value[1]
      )
    )
      return false;
    if (
      Object.entries(state.binary).some(
        ([key, value]) => value !== undefined && data.properties[key] != value
      )
    )
      return false;
    return true;
  };

  return (
    <FilterContext.Provider
      value={{
        ...state,
        //...(activityContext.loaded && {
        //  filterIDs: activityContext.geoJson.features
        //    .filter(this.filterFn)
        //    .map((feature) => feature.properties.id),
        //}),
        toggleCategory: toggleCategory,
        setOnlyCategory: setOnlyCategory,
        updateCategoryFilter: updateCategoryFilter,
        updateValueFilter: updateValueFilter,
        setSelected: setSelected,
        setHighlighted: setHighlighted,
        setSearch: setSearch,
        setBinary: setBinary,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export { FilterContext };
