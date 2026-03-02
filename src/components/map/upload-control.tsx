'use client';

import { Upload } from 'lucide-react';
import { useShallowStore } from '~/store';
import { useRef } from 'react';
import toGeoJSON from '@mapbox/togeojson';
import { MapControlIconButton } from './map-control-icon-button';

export function UploadControl() {
  const { setUploadedGeoJson } = useShallowStore((state) => ({
    setUploadedGeoJson: state.setUploadedGeoJson,
  }));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        const geoJson = toGeoJSON.gpx(xmlDoc);
        setUploadedGeoJson(geoJson);
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <MapControlIconButton
        onClick={() => fileInputRef.current?.click()}
        aria-label="Upload GPX file"
      >
        <Upload color="black" />
      </MapControlIconButton>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".gpx"
        className="hidden"
      />
    </>
  );
}
