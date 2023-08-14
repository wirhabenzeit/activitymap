import { useContext, createContext, useState, useEffect, useRef } from "react";
import { categorySettings, filterSettings, binaryFilters } from "../settings";
import { ActivityContext } from "./ActivityContext";

const filterState = {
  categories: {},
  values: {},
  search: "",
  binary: {},
  filterRanges: {},
  filterRangesSet: false,
  filterIDs: [],
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

function useTraceUpdate(props) {
  const prev = useRef(props);
  useEffect(() => {
    const changedProps = Object.entries(props).reduce((ps, [k, v]) => {
      if (prev.current[k] !== v) {
        ps[k] = [prev.current[k], v];
      }
      return ps;
    }, {});
    if (Object.keys(changedProps).length > 0) {
    }
    prev.current = props;
  });
}
function usePrevious(value) {
  const ref = useRef();
  useEffect(() => {
    ref.current = value; //assign the value of ref to the argument
  }, [value]); //this code will run when the value of 'value' changes
  return ref.current; //in the end, return the current ref value.
}

export function FilterContextProvider({ children }) {
  const [state, setState] = useState(filterState);
  const activityContext = useContext(ActivityContext);

  const prevState = usePrevious(state);

  /*useEffect(() => {
    console.log("fc: detected state change");
    const stateEntries = Object.entries(state);
    const changedProps = stateEntries.filter(([key, value]) => {
      return !prevState || value !== prevState[key];
    });
    if (changedProps.length > 0) {
      console.log("fc detected changes -- ", changedProps);
    }
  }, [state]);*/

  console.log("FilterContextProvider render");

  useEffect(() => {
    if (
      activityContext.loaded &&
      !state.filterRangesSet &&
      activityContext.geoJson.features.length > 1
    ) {
      setFilterRanges();
    }
  }, [activityContext]);

  const setStateCustom = (fn) => {
    setState((prev) => {
      const newState = fn(prev);
      const filterIDs = Object.entries(activityContext.activityDict)
        .filter(([key, value]) => filterFn(value, newState))
        .map(([key, value]) => Number(key));
      //console.log(newState, filterIDs, activityContext.activityDict);
      return {
        ...newState,
        filterIDs: filterIDs,
      };
    });
  };

  const setFilterRanges = () => {
    const filterRanges = Object.entries(filterSettings)
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
      .reduce((obj, [key, value]) => ((obj[key] = value), obj), {});
    //console.log("filter Ranges:", filterRanges);
    setStateCustom((prev) => ({
      ...prev,
      filterRangesSet: true,
      filterRanges: filterRanges,
      values: filterRanges,
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
    //console.log("setBinary", selectedID, newValue);
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
    if (!activeCat.includes(data.properties.sport_type)) {
      return false;
    }
    if (
      state.search &&
      !data.properties["name"]
        .toLowerCase()
        .includes(state.search.toLowerCase())
    ) {
      return false;
    }
    if (
      Object.entries(state.values).some(
        ([key, value]) =>
          data.properties[key] < value[0] || data.properties[key] > value[1]
      )
    ) {
      return false;
    }
    if (
      Object.entries(state.binary).some(
        ([key, value]) => value !== undefined && data.properties[key] != value
      )
    ) {
      return false;
    }
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
        setSearch: setSearch,
        setBinary: setBinary,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export { FilterContext };
