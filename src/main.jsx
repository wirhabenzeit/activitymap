import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ActivityContextProvider } from "./contexts/ActivityContext.jsx";
import { FilterContextProvider } from "./contexts/FilterContext.jsx";
import { MapContextProvider } from "./contexts/MapContext.jsx";
import { ListContextProvider } from "./contexts/ListContext.jsx";
import { BrowserRouter as Router } from "react-router-dom";
import { SelectionContextProvider } from "./contexts/SelectionContext.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <Router basename="/stravamap">
    <ActivityContextProvider>
      <MapContextProvider>
        <ListContextProvider>
          <FilterContextProvider>
            <SelectionContextProvider>
              <App />
            </SelectionContextProvider>
          </FilterContextProvider>
        </ListContextProvider>
      </MapContextProvider>
    </ActivityContextProvider>
  </Router>
);
