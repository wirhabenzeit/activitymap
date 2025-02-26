import { useState } from 'react';

import { Map } from 'lucide-react';

import { useShallowStore } from '~/store';

import { mapSettings } from '~/settings/map';

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
  const { overlayMaps, baseMap, toggleOverlayMap, setBaseMap } =
    useShallowStore((state) => ({
      overlayMaps: state.overlayMaps,
      baseMap: state.baseMap,
      toggleOverlayMap: state.toggleOverlayMap,
      setBaseMap: state.setBaseMap,
    }));

  return (
    <div className="z-1 h-[29px] w-[29px] rounded-md bg-white">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="[&_svg]:size-5">
            <Map className="mx-auto" color="black" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Base Map</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={baseMap} onValueChange={setBaseMap}>
            {Object.entries(mapSettings)
              .filter(([, val]) => val.overlay === false)
              .map(([key]) => (
                <DropdownMenuRadioItem value={key} key={key}>
                  {key}
                </DropdownMenuRadioItem>
              ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuLabel>Overlays</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {Object.entries(mapSettings)
            .filter(([, val]) => val.overlay === true)
            .map(([key]) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={overlayMaps.includes(key)}
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
