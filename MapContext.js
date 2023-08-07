import React, { Component, createContext } from "react";
import { mapSettings } from "./settings";

const mapPosition = {
  zoom: 9,
  longitude: 8,
  latitude: 47,
  pitch: 0,
  bearing: 0,
};
const mapState = {
  baseMap: null,
  overlayMaps: [],
  threeDim: false,
  position: mapPosition,
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
    const { children } = this.props;
    return (
      <MapContext.Provider
        value={{
          ...this.state,
          setBaseMap: this.setBaseMap,
          toggleOverlayMap: this.toggleOverlayMap,
          toggleThreeDim: this.toggleThreeDim,
          updateMapPosition: this.updateMapPosition,
          setThreeDim: this.setThreeDim,
          setOverlayMaps: this.setOverlayMaps,
        }}
      >
        {children}
      </MapContext.Provider>
    );
  }

  setBaseMap = (key) => {
    this.setState((map) => ({ ...map, baseMap: key }));
  };

  setOverlayMaps = (keys) => {
    this.setState((map) => ({ ...map, overlayMaps: keys }));
  };

  setThreeDim = (threeDim) => {
    console.log("Setting threeDim", threeDim);
    this.setState((map) => ({ ...map, threeDim: threeDim }));
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

  toggleThreeDim = () => {
    this.setState((map) => ({ ...map, threeDim: !map.threeDim }));
  };

  updateMapPosition = (newPosition) => {
    this.setState((map) => ({ ...map, position: newPosition }));
  };
}

export { MapContext };
