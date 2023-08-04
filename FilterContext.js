import React, { useState, createContext, useContext } from "react";
import { categorySettings, filterSettings } from "./settings";

const filterState = { categories: {}, values: {}, selected: [] };

Object.entries(categorySettings).forEach(([key, category]) => {
  filterState.categories[key] = {
    active: category.active,
    filter: category.active ? category.alias : [],
  };
});

Object.entries(filterSettings).forEach(([key, filter]) => {
  filterState.values[key] = [undefined, undefined];
});

const FilterContext = createContext(filterState);

export const FilterContextProvider = ({ children }) => {
  const [filter, setFilter] = useState(filterState);

  const setSelected = (selected) => {
    //console.log("setSelected", selected);
    setFilter((filter) => ({ ...filter, selected: selected }));
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

  return (
    <FilterContext.Provider
      value={{
        ...filter,
        toggleCategory,
        updateCategoryFilter,
        updateValueFilter,
        setSelected,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
};

export { FilterContext };
