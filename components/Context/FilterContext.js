import React, { useState, createContext, useEffect } from "react";
import { categorySettings, filterSettings, binaryFilters } from "@/settings";

const filterState = {
  categories: {},
  values: {},
  search: "",
  binary: {},
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
});

Object.entries(binaryFilters).forEach(([key, filter]) => {
  filterState.binary[key] = filter.defaultValue;
});

const FilterContext = createContext(filterState);

export const FilterContextProvider = ({ children }) => {
  const [filter, setFilter] = useState(filterState);
  console.log("FilterContextProvider render");

  useEffect(() => {
    console.log("filter", filter);
  }, [filter]);

  const setSelected = (selected) => {
    console.log("setSelected", selected);
    setFilter((filter) => ({
      ...filter,
      selected: selected,
      highlighted: 0,
    }));
  };

  const setHighlighted = (highlighted) => {
    setFilter((filter) => ({ ...filter, highlighted: highlighted }));
  };

  const setOnlyCategory = (selectedID) => {
    setFilter((filter) => {
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
    if (filter.categories[selectedID].active) {
      setFilter((filter) => ({
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
      setFilter((filter) => ({
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
      setFilter((filter) => ({
        ...filter,
        values: { ...filter.values, [selectedID]: newFilter },
      }));
    } else {
      setFilter((filter) => ({
        ...filter,
        values: { ...filter.values, [selectedID]: [undefined, undefined] },
      }));
    }
  };

  const setSearch = (newSearch) => {
    setFilter((filter) => ({
      ...filter,
      search: newSearch,
    }));
  };

  const setBinary = (selectedID, newValue) => {
    setFilter((filter) => ({
      ...filter,
      binary: { ...filter.binary, [selectedID]: newValue },
    }));
  };

  const updateCategoryFilter = (selectedID, newFilter) => {
    if (newFilter.length > 0) {
      setFilter((filter) => ({
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
      setFilter((filter) => ({
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

  const activeCat = [];
  Object.entries(filter.categories).forEach(([key, value]) => {
    activeCat.push(...value.filter);
  });

  const filterFn = (data) => {
    if (!activeCat.includes(data.properties.sport_type)) return false;
    if (
      filter.search &&
      !data.properties.name.toLowerCase().includes(filter.search.toLowerCase())
    )
      return false;
    if (
      Object.entries(filter.values).some(
        ([key, value]) =>
          data.properties[key] < value[0] || data.properties[key] > value[1]
      )
    )
      return false;
    if (
      Object.entries(filter.binary).some(
        ([key, value]) => value !== undefined && data.properties[key] != value
      )
    )
      return false;
    return true;
  };

  return (
    <FilterContext.Provider
      value={{
        ...filter,
        toggleCategory,
        setOnlyCategory,
        updateCategoryFilter,
        updateValueFilter,
        setSelected,
        setHighlighted,
        setSearch,
        setBinary,
        filterFn,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
};

export { FilterContext };
