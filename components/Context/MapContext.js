import React, { Component, createContext } from "react";
import { mapSettings } from "@/settings";

const mapState = {
  baseMap: null,
  overlayMaps: [],
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

export class MapContextProvider extends Component {
  constructor() {
    super();
    this.state = mapState;
  }

  render() {
    console.log("MapContextProvider render");
    const { children } = this.props;
    return (
      <MapContext.Provider
        value={{
          ...this.state,
          setBaseMap: this.setBaseMap,
          toggleOverlayMap: this.toggleOverlayMap,
          toggleThreeDim: this.toggleThreeDim,
          setOverlayMaps: this.setOverlayMaps,
          setThreeDim: this.setThreeDim,
        }}
      >
        {children}
      </MapContext.Provider>
    );
  }

  setBaseMap = (key) => {
    this.setState((map) => ({ ...map, baseMap: key }));
  };

  toggleOverlayMap = (key) => {
    this.setState((map) => {
      if (map.overlayMaps.includes(key))
        return {
          ...map,
          overlayMaps: map.overlayMaps.filter((item) => item !== key),
        };
      else return { ...map, overlayMaps: [...map.overlayMaps, key] };
    });
  };

  setOverlayMaps = (overlayMaps) => {
    this.setState((map) => ({ ...map, overlayMaps: overlayMaps }));
  };

  setThreeDim = (threeDim) => {
    this.setState((map) => ({ ...map, threeDim: threeDim }));
  };

  toggleThreeDim = () => {
    this.setState((map) => ({ ...map, threeDim: !map.threeDim }));
  };
}

export { MapContext };
