import "@/styles/globals.css";
import { FilterContextProvider } from "@/components/Context/FilterContext";
import { MapContextProvider } from "@/components/Context/MapContext";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import { ActivityContextProvider } from "@/components/Context/ActivityContext";
import { ListContextProvider } from "@/components/Context/ListContext";
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
