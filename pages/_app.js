import "@/styles/globals.css";
import { FilterContextProvider } from "@/FilterContext";
import { MapContextProvider } from "@/MapContext";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import { ActivityContextProvider } from "@/ActivityContext";
import { ListContextProvider } from "@/ListContext";
import Router from "@/Router";

export default function App({ Component, pageProps }) {
  return (
    <FilterContextProvider>
      <MapContextProvider>
        <ActivityContextProvider>
          <ListContextProvider>
            <Router>
              <Component {...pageProps} />
            </Router>
          </ListContextProvider>
        </ActivityContextProvider>
      </MapContextProvider>
    </FilterContextProvider>
  );
}
