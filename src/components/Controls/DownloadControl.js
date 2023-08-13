import FileSaver from "file-saver";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export class DownloadControl {
  constructor() {
    this._container = undefined;
    this._map = undefined;
  }

  onAdd = (map) => {
    this._map = map;
    this._container = document.createElement("div");
    this._container.id = "download-button-container";
    this._container.className = "mapboxgl-ctrl mapboxgl-ctrl-group";
    const button = document.createElement("button");
    button.id = "download-button";
    button.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 512 512"><!--! Font Awesome Free 6.4.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2023 Fonticons, Inc. --><path d="M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32V274.7l-73.4-73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0l128-128c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L288 274.7V32zM64 352c-35.3 0-64 28.7-64 64v32c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V416c0-35.3-28.7-64-64-64H346.5l-45.3 45.3c-25 25-65.5 25-90.5 0L165.5 352H64zm368 56a24 24 0 1 1 0 48 24 24 0 1 1 0-48z"/></svg>';

    button.onclick = () => {
      button.style.cursor = "wait";
      var actualPixelRatio = window.devicePixelRatio;
      Object.defineProperty(window, "devicePixelRatio", {
        get: function () {
          return 450 / 96;
        },
      });
      console.log(
        `Pixel ratio changed from ${actualPixelRatio} to ${window.devicePixelRatio}`
      );
      var hidden = document.createElement("div");
      hidden.style.width = 0;
      hidden.style.height = 0;
      hidden.style.overflow = "hidden";
      hidden.style.position = "fixed";
      hidden.style.zIndex = -1;
      hidden.style.visibility = "hidden";
      document.body.appendChild(hidden);
      var container = document.createElement("div");
      container.style.width = `${window.innerWidth}px`;
      container.style.height = `${window.innerHeight}px`;
      console.log(
        `Container size: ${container.style.width} x ${container.style.height}`
      );
      hidden.appendChild(container);

      var renderMap = new mapboxgl.Map({
        container: container,
        center: map.getCenter(),
        zoom: map.getZoom(),
        style: map.getStyle(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        interactive: false,
        preserveDrawingBuffer: true,
        fadeDuration: 0,
        attributionControl: false,
      });
      renderMap.once("idle", function () {
        renderMap.getCanvas().toBlob(
          function (blob) {
            FileSaver.saveAs(blob, "map.jpg");
          },
          "image/jpeg",
          0.8
        );

        renderMap.remove();
        hidden.parentNode.removeChild(hidden);
        Object.defineProperty(window, "devicePixelRatio", {
          get: function () {
            return actualPixelRatio;
          },
        });
        button.style.cursor = "pointer";
      });
    };

    this._container.appendChild(button);
    return this._container;
  };

  onRemove() {
    this._container.parentNode.removeChild(this._container);
    this._map;
  }
}
