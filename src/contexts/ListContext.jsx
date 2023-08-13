import { listSettings } from "/src/settings";
import { createContext, Component } from "react";

const ListContext = createContext(listSettings.defaultState);

export class ListContextProvider extends Component {
  constructor() {
    super();
    //console.log("ListContextProvider constructor")
    this.state = listSettings.defaultState;
  }

  render() {
    console.log("ListContextProvider render");
    const { children } = this.props;
    return (
      <ListContext.Provider
        value={{
          ...this.state,
          setSortModel: this.setSortModel,
          setColumnVisibilityModel: this.setColumnVisibilityModel,
        }}
      >
        {children}
      </ListContext.Provider>
    );
  }

  setSortModel = (key, newSortModel) => {
    //console.log("setSortModel", newSortModel, key);
    this.setState((list) => ({
      ...list,
      [key]: { ...list[key], sortModel: newSortModel },
    }));
  };

  setColumnVisibilityModel = (key, newColumnVisibilityModel) => {
    this.setState((list) => ({
      ...list,
      [key]: { ...list[key], columnVisibilityModel: newColumnVisibilityModel },
    }));
  };
}

export { ListContext };
