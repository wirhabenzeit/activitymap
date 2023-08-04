import React, {
  Component,
  useState,
  useEffect,
  createContext,
  useContext,
  use,
} from "react";
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
  threeDim: true,
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

  toggleThreeDim = () => {
    this.setState((map) => ({ ...map, threeDim: !map.threeDim }));
  };

  updateMapPosition = (newPosition) => {
    this.setState((map) => ({ ...map, position: newPosition }));
  };
}

export { MapContext };
