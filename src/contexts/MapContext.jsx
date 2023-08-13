import React, { useState, useEffect, createContext } from "react";
import { mapSettings, defaultMapPosition } from "../settings";
import { useSearchParams } from "react-router-dom";

const mapState = {
  baseMap: null,
  overlayMaps: [],
  position: defaultMapPosition,
  threeDim: false,
};

Object.entries(mapSettings).forEach(([key, map]) => {
  if (map.visible && map.overlay) mapState.overlayMaps.push(key);
  else if (map.visible && !map.overlay && mapState.baseMap == null)
    mapState.baseMap = key;
  else if (map.visible && !map.overlay && mapState.baseMap != null) {
    console.log("Error: Multiple base maps selected. Please check settings.js");
  }
});

const MapContext = createContext(mapState);

export function MapContextProvider({ children }) {
  const [state, setState] = useState(mapState);
  let [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const paramState = {};
    Object.keys(mapState).forEach((key) => {
      if (searchParams.has(key)) {
        paramState[key] = JSON.parse(searchParams.get(key));
      }
    });
    setState((map) => ({ ...map, ...paramState }));
  }, []);

  const setBaseMap = (key) => {
    setState((map) => ({ ...map, baseMap: key }));
  };

  const toggleOverlayMap = (key) => {
    setState((map) => {
      if (map.overlayMaps.includes(key))
        return {
          ...map,
          overlayMaps: map.overlayMaps.filter((item) => item !== key),
        };
      else return { ...map, overlayMaps: [...map.overlayMaps, key] };
    });
  };

  const setOverlayMaps = (overlayMaps) => {
    setState((map) => ({ ...map, overlayMaps: overlayMaps }));
  };

  const setThreeDim = (threeDim) => {
    setState((map) => ({ ...map, threeDim: threeDim }));
  };

  const toggleThreeDim = () => {
    setState((map) => ({ ...map, threeDim: !map.threeDim }));
  };

  const setPosition = (position) => {
    setState((map) => ({ ...map, position: position }));
  };
  console.log("MapContextProvider render");

  return (
    <MapContext.Provider
      value={{
        ...state,
        setBaseMap: setBaseMap,
        toggleOverlayMap: toggleOverlayMap,
        toggleThreeDim: toggleThreeDim,
        setOverlayMaps: setOverlayMaps,
        setThreeDim: setThreeDim,
        setPosition: setPosition,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export { MapContext };
