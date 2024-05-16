"use client";

import {DownloadOutlined} from "@mui/icons-material";
import {IconButton, Paper} from "@mui/material";
import FileSaver from "file-saver";
import mapboxgl from "mapbox-gl";
import {useMap} from "react-map-gl";

mapboxgl.accessToken = process.env
  .NEXT_PUBLIC_MAPBOX_TOKEN!;

export function Download() {
  const map = useMap();

  const download = () => {
    if (map.current == undefined) return;
    console.log(map);
    const actualPixelRatio = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", {
      get: function () {
        return 450 / 96;
      },
    });
    const hidden = document.createElement("div");
    Object.assign(hidden.style, {
      width: "0",
      height: "0",
      overflow: "hidden",
      position: "fixed",
      zIndex: "-1",
      visibility: "hidden",
    });
    document.body.appendChild(hidden);
    const container = document.createElement("div");
    container.style.width = `${window.innerWidth}px`;
    container.style.height = `${window.innerHeight}px`;
    hidden.appendChild(container);

    const renderMap = new mapboxgl.Map({
      container: container,
      center: map.current.getCenter(),
      zoom: map.current.getZoom(),
      style: map.current.getStyle(),
      bearing: map.current.getBearing(),
      pitch: map.current.getPitch(),
      interactive: false,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
      attributionControl: false,
    });
    renderMap.once("idle", function () {
      renderMap.getCanvas().toBlob(
        (blob: Blob | null) => {
          if (blob == null) return;
          FileSaver.saveAs(blob, "map.jpg");
        },
        "image/jpeg",
        0.8
      );

      renderMap.remove();
      hidden.parentNode!.removeChild(hidden);
      Object.defineProperty(window, "devicePixelRatio", {
        get: function () {
          return actualPixelRatio;
        },
      });
    });
  };

  return (
    <Paper
      sx={{
        p: 0,
        width: "29px",
        height: "29px",
        borderRadius: 1,
      }}
      elevation={1}
    >
      <IconButton
        onClick={download}
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <DownloadOutlined
          fontSize="medium"
          sx={{color: "black", mt: "2px"}}
        />
      </IconButton>
    </Paper>
  );
}
