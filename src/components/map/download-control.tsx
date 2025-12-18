'use client';

import { Button } from '../ui/button';
import { Download as DownloadIcon } from 'lucide-react';
import FileSaver from 'file-saver';
import mapboxgl from 'mapbox-gl';
import { useMap } from 'react-map-gl/mapbox';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

export function Download() {
  const map = useMap();

  const download = () => {
    if (map.current == undefined) return;

    const actualPixelRatio = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', {
      get: function () {
        return 450 / 96;
      },
    });
    const hidden = document.createElement('div');
    Object.assign(hidden.style, {
      width: '0',
      height: '0',
      overflow: 'hidden',
      position: 'fixed',
      zIndex: '-1',
      visibility: 'hidden',
    });
    document.body.appendChild(hidden);
    const container = document.createElement('div');
    container.style.width = `${window.innerWidth}px`;
    container.style.height = `${window.innerHeight}px`;
    hidden.appendChild(container);

    const renderMap = new mapboxgl.Map({
      container: container,
      center: map.current.getCenter(),
      zoom: map.current.getZoom(),
      style: map.current.getStyle() ?? undefined,
      bearing: map.current.getBearing(),
      pitch: map.current.getPitch(),
      interactive: false,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
      attributionControl: false,
    });
    renderMap.once('idle', function () {
      renderMap.getCanvas().toBlob(
        (blob: Blob | null) => {
          if (blob == null) return;
          FileSaver.saveAs(blob, 'map.jpg');
        },
        'image/jpeg',
        0.8,
      );

      renderMap.remove();
      hidden.parentNode!.removeChild(hidden);
      Object.defineProperty(window, 'devicePixelRatio', {
        get: function () {
          return actualPixelRatio;
        },
      });
    });
  };

  return (
    <div className="z-1 h-[29px] w-[29px] rounded-md bg-white">
      <Button onClick={download} className="[&_svg]:size-5">
        <DownloadIcon className="mx-auto" color="black" />
      </Button>
    </div>
  );
}
