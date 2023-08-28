import React, { useState, createContext } from "react";

const selectionState = {
  selected: [],
  highlighted: 0,
};

const SelectionContext = createContext(selectionState);

export function SelectionContextProvider({ children }) {
  const [state, setState] = useState(selectionState);
  console.log("SelectionContextProvider render");

  const setSelected = (newSelected) => {
    setState((filter) => ({
      ...filter,
      selected:
        typeof newSelected === "function"
          ? newSelected(filter.selected)
          : [...new Set(newSelected)],
      highlighted: 0,
    }));
  };

  const setHighlighted = (highlighted) => {
    setState((filter) => ({
      ...filter,
      highlighted: highlighted,
    }));
  };

  return (
    <SelectionContext.Provider
      value={{
        ...state,
        setSelected: setSelected,
        setHighlighted: setHighlighted,
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

export { SelectionContext };
