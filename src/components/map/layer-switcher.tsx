import { useState } from 'react';

import { Map } from 'lucide-react';

import { useShallowStore } from '~/store';

import { baseMaps, overlayMaps as overlayMapSettings } from '~/settings/map';

import { Button } from '~/components/ui/button';
import { MapControlIconButton } from '~/components/map/map-control-icon-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

export function DropdownMenuRadioGroupDemo() {
  const [position, setPosition] = useState('bottom');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Panel Position</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={position} onValueChange={setPosition}>
          <DropdownMenuRadioItem value="top">Top</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="bottom">Bottom</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="right">Right</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LayerSwitcher() {
  const {
    overlayMaps: activeOverlays,
    baseMap,
    toggleOverlayMap,
    setBaseMap,
  } = useShallowStore((state) => ({
    overlayMaps: state.overlayMaps,
    baseMap: state.baseMap,
    toggleOverlayMap: state.toggleOverlayMap,
    setBaseMap: state.setBaseMap,
  }));

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <MapControlIconButton aria-label="Map layers">
          <Map color="black" />
        </MapControlIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 h-120 overflow-y-auto">
        <DropdownMenuLabel>Base Map</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={baseMap}
          onValueChange={(value) =>
            setBaseMap(value as keyof typeof baseMaps)
          }
        >
          {(Object.entries(baseMaps) as Array<
            [keyof typeof baseMaps, (typeof baseMaps)[keyof typeof baseMaps]]
          >).map(([key, setting]) => (
            <DropdownMenuRadioItem value={key} key={key}>
              {setting.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuLabel>Overlays</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.entries(overlayMapSettings) as Array<
          [keyof typeof overlayMapSettings, (typeof overlayMapSettings)[keyof typeof overlayMapSettings]]
        >).map(([key, setting]) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={activeOverlays.includes(key)}
            onClick={() => {
              toggleOverlayMap(key);
            }}
          >
            {setting.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
