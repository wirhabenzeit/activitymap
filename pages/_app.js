import "@/styles/globals.css";
import { FilterContextProvider } from "@/components/Context/FilterContext";
import { MapContextProvider } from "@/components/Context/MapContext";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import { ActivityContextProvider } from "@/components/Context/ActivityContext";
import { ListContextProvider } from "@/components/Context/ListContext";
import { Profiler } from "react";

import NextAdapterApp from "next-query-params/app";
import { QueryParamProvider } from "use-query-params";

export default function App({ Component, pageProps }) {
  return (
    <QueryParamProvider adapter={NextAdapterApp}>
      <ActivityContextProvider>
        <FilterContextProvider>
          <MapContextProvider>
            <ListContextProvider>
              <Component {...pageProps} />
            </ListContextProvider>
          </MapContextProvider>
        </FilterContextProvider>
      </ActivityContextProvider>
    </QueryParamProvider>
  );
}
