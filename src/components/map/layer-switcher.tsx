import { Camera, Map, Mountain } from 'lucide-react';
import { useState } from 'react';

import { MapControlIconButton } from '~/components/map/map-control-icon-button';
import {
  PreferenceMenuCheckboxItem,
  PreferenceMenuContent,
} from '~/components/preference-menu';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { baseMaps, overlayMaps as overlayMapSettings } from '~/settings/map';
import { useShallowStore } from '~/store';

export function DropdownMenuRadioGroupDemo() {
  const [position, setPosition] = useState('bottom');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <PreferenceMenuContent className="w-56">
        <DropdownMenuLabel>Panel Position</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={position} onValueChange={setPosition}>
          <DropdownMenuRadioItem value="top">Top</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="bottom">Bottom</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="right">Right</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </PreferenceMenuContent>
    </DropdownMenu>
  );
}

export function LayerSwitcher() {
  const {
    overlayMaps: activeOverlays,
    baseMap,
    toggleOverlayMap,
    setBaseMap,
    showPhotos,
    togglePhotos,
    showPlaces,
    togglePlaces,
  } = useShallowStore((state) => ({
    overlayMaps: state.overlayMaps,
    baseMap: state.baseMap,
    toggleOverlayMap: state.toggleOverlayMap,
    setBaseMap: state.setBaseMap,
    showPhotos: state.showPhotos,
    togglePhotos: state.togglePhotos,
    showPlaces: state.showPlaces,
    togglePlaces: state.togglePlaces,
  }));

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <MapControlIconButton aria-label="Map layers">
          <Map color="black" />
        </MapControlIconButton>
      </DropdownMenuTrigger>
      <PreferenceMenuContent className="w-56">
        <DropdownMenuLabel>Activities</DropdownMenuLabel>
        <PreferenceMenuCheckboxItem
          checked={showPhotos}
          onCheckedChange={togglePhotos}
          className="gap-2"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Photos
        </PreferenceMenuCheckboxItem>
        <PreferenceMenuCheckboxItem
          checked={showPlaces}
          onCheckedChange={togglePlaces}
          className="gap-2"
        >
          <Mountain className="h-4 w-4" aria-hidden="true" />
          Places
        </PreferenceMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Base Map</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={baseMap}
          onValueChange={(value) => setBaseMap(value as keyof typeof baseMaps)}
        >
          {(
            Object.entries(baseMaps) as Array<
              [keyof typeof baseMaps, (typeof baseMaps)[keyof typeof baseMaps]]
            >
          ).map(([key, setting]) => (
            <DropdownMenuRadioItem value={key} key={key}>
              {setting.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuLabel>Overlays</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(
          Object.entries(overlayMapSettings) as Array<
            [
              keyof typeof overlayMapSettings,
              (typeof overlayMapSettings)[keyof typeof overlayMapSettings],
            ]
          >
        ).map(([key, setting]) => (
          <PreferenceMenuCheckboxItem
            key={key}
            checked={activeOverlays.includes(key)}
            onCheckedChange={() => toggleOverlayMap(key)}
          >
            {setting.label}
          </PreferenceMenuCheckboxItem>
        ))}
      </PreferenceMenuContent>
    </DropdownMenu>
  );
}
