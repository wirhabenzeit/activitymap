import { listSettings } from "/src/settings";
import { createContext, Component } from "react";
import { ActivityContext } from "./ActivityContext";

const ListContext = createContext(listSettings.defaultState);

export class ListContextProvider extends Component {
  static contextType = ActivityContext;
  constructor() {
    super();
    //console.log("ListContextProvider constructor")
    this.state = listSettings(this.context).defaultState;
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
