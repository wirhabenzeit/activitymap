import { useState } from 'react';

import { Map } from 'lucide-react';

import { useShallowStore } from '~/store';

import { baseMaps, overlayMaps as overlayMapSettings } from '~/settings/map';

import { Button } from '~/components/ui/button';
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
    <div className="z-1 h-[29px] w-[29px] rounded-md bg-white">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="[&_svg]:size-5">
            <Map className="mx-auto" color="black" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56 h-120 overflow-y-auto">
          <DropdownMenuLabel>Base Map</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={baseMap} onValueChange={setBaseMap}>
            {Object.entries(baseMaps).map(([key]) => (
              <DropdownMenuRadioItem value={key} key={key}>
                {key}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuLabel>Overlays</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {Object.entries(overlayMapSettings).map(([key]) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={activeOverlays.includes(key)}
              onClick={() => {
                toggleOverlayMap(key);
              }}
            >
              {key}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
