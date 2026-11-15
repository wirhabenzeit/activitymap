import { Image as ImageIcon, Landmark, Layers } from 'lucide-react';
import { useMemo, useState } from 'react';

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
import { useSelectedActivityPlaces } from '~/hooks/use-activity-places';
import type { Activity } from '~/lib/activity';
import { validPhotoLocation } from '~/lib/photo-gallery';
import type { Photo } from '~/server/records';
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

const noActivityIds: number[] = [];
const noActivities: ReadonlyMap<number, Activity> = new Map();
const noPhotos: Photo[] = [];

function LayerHint({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="px-2 pb-1.5 pl-8 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** `activities`, `visibleIds` and `photos` describe the current filtered set, so
 * the menu can say when a layer has nothing to show (as the iOS layers menu does). */
export function LayerSwitcher({
  activities = noActivities,
  visibleIds = noActivityIds,
  photos = noPhotos,
}: {
  activities?: ReadonlyMap<number, Activity>;
  visibleIds?: number[];
  photos?: Photo[];
}) {
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
  const hasLocatedPhotos = useMemo(() => {
    const visible = new Set(visibleIds);
    return photos.some(
      (photo) =>
        visible.has(photo.activity_id) && validPhotoLocation(photo.location),
    );
  }, [photos, visibleIds]);
  const places = useSelectedActivityPlaces(
    activities,
    noActivityIds,
    showPlaces ? visibleIds : noActivityIds,
  );
  const noPlaces =
    showPlaces && !places.isLoading && places.places.length === 0;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <MapControlIconButton aria-label="Map layers">
          {/* The Mapbox control group is always white; keep the glyph dark. */}
          <Layers color="black" />
        </MapControlIconButton>
      </DropdownMenuTrigger>
      <PreferenceMenuContent className="w-56">
        <DropdownMenuLabel>Activities</DropdownMenuLabel>
        <PreferenceMenuCheckboxItem
          checked={showPhotos}
          onCheckedChange={togglePhotos}
          className="gap-2"
          aria-describedby={
            showPhotos && !hasLocatedPhotos ? 'layer-photos-hint' : undefined
          }
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          Photos
        </PreferenceMenuCheckboxItem>
        {showPhotos && !hasLocatedPhotos && (
          <LayerHint id="layer-photos-hint">
            No located photos in the current filter
          </LayerHint>
        )}
        <PreferenceMenuCheckboxItem
          checked={showPlaces}
          onCheckedChange={togglePlaces}
          className="gap-2"
          aria-describedby={noPlaces ? 'layer-places-hint' : undefined}
        >
          {/* TODO(ios): iOS uses mountain.2 here, which collides with the elevation metric glyph. */}
          <Landmark className="h-4 w-4" aria-hidden="true" />
          Places
        </PreferenceMenuCheckboxItem>
        {noPlaces && (
          <LayerHint id="layer-places-hint">
            No matched places saved in the current filter
          </LayerHint>
        )}
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
