import { Image as ImageIcon, Landmark, Layers } from 'lucide-react';
import { useMemo, useState } from 'react';

import { MapControlIconButton } from '~/components/map/map-control-icon-button';
import {
  PreferenceMenuCheckboxItem,
  PreferenceMenuContent,
  PreferenceMenuSubContent,
} from '~/components/preference-menu';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { useSelectedActivityPlaces } from '~/hooks/use-activity-places';
import type { Activity } from '~/lib/activity';
import { groupedOverlayIDs, overlayGroups } from '~/lib/map-catalog';
import { validPhotoLocation } from '~/lib/photo-gallery';
import type { Photo } from '~/server/records';
import {
  type BaseMapId,
  baseMapGroups,
  baseMaps,
  isBaseMapAvailable,
  overlayMaps as overlayMapSettings,
  renderableBaseMap,
} from '~/settings/map';
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
          {/* The MapLibre control group is always white; keep the glyph dark. */}
          <Layers color="black" />
        </MapControlIconButton>
      </DropdownMenuTrigger>
      <PreferenceMenuContent className="w-56">
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
        {baseMapGroups.map((group) => {
          const maps = group.maps.filter(isBaseMapAvailable);
          if (!maps.length) return null;
          if (maps.length === 1) {
            const id = maps[0]!;
            return (
              <DropdownMenuRadioGroup
                key={group.id}
                value={renderableBaseMap(baseMap)}
                onValueChange={(value) => setBaseMap(value as BaseMapId)}
              >
                <DropdownMenuRadioItem value={id}>
                  {group.label}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            );
          }
          return (
            <DropdownMenuSub key={group.id}>
              <DropdownMenuSubTrigger>{group.label}</DropdownMenuSubTrigger>
              <PreferenceMenuSubContent>
                <DropdownMenuRadioGroup
                  value={renderableBaseMap(baseMap)}
                  onValueChange={(value) => setBaseMap(value as BaseMapId)}
                >
                  {maps.map((id) => (
                    <DropdownMenuRadioItem value={id} key={id}>
                      {baseMaps[id].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </PreferenceMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Overlays</DropdownMenuLabel>
        {(
          Object.entries(overlayMapSettings) as Array<
            [
              keyof typeof overlayMapSettings,
              (typeof overlayMapSettings)[keyof typeof overlayMapSettings],
            ]
          >
        )
          .filter(([key]) => !groupedOverlayIDs.has(key))
          .map(([key, setting]) => (
            <PreferenceMenuCheckboxItem
              key={key}
              checked={activeOverlays.includes(key)}
              onCheckedChange={() => toggleOverlayMap(key)}
            >
              {setting.label}
            </PreferenceMenuCheckboxItem>
          ))}
        {overlayGroups.map((group) => (
          <DropdownMenuSub key={group.id}>
            <DropdownMenuSubTrigger>{group.label}</DropdownMenuSubTrigger>
            <PreferenceMenuSubContent>
              {group.overlays.map((id) => {
                const key = id as keyof typeof overlayMapSettings;
                return (
                  <PreferenceMenuCheckboxItem
                    key={key}
                    checked={activeOverlays.includes(key)}
                    onCheckedChange={() => toggleOverlayMap(key)}
                  >
                    {overlayMapSettings[key].label}
                  </PreferenceMenuCheckboxItem>
                );
              })}
            </PreferenceMenuSubContent>
          </DropdownMenuSub>
        ))}
      </PreferenceMenuContent>
    </DropdownMenu>
  );
}
