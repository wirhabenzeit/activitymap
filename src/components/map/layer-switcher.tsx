import { Image as ImageIcon, Landmark, Layers } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';

import { RegionIcon } from '~/components/map/country-flag';
import { MapControlIconButton } from '~/components/map/map-control-icon-button';
import {
  PreferenceMenuCheckboxItem,
  PreferenceMenuContent,
  PreferenceMenuSubContent,
} from '~/components/preference-menu';
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
import { cn } from '~/lib/utils';
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

type OverlayId = keyof typeof overlayMapSettings;

const noActivityIds: number[] = [];
const noActivities: ReadonlyMap<number, Activity> = new Map();
const noPhotos: Photo[] = [];

function LayerHint({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="px-2 pb-1.5 pl-14 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** Every root row shares one layout: a 24px state gutter (`pl-8`), a 16px
 * icon, the label, then a muted value and/or chevron. */
const rowClass = 'gap-2';

function SectionLabel({ children }: { children: string }) {
  return (
    <DropdownMenuLabel className="pt-2 pb-1 pl-8 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </DropdownMenuLabel>
  );
}

function RowText({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate">{children}</span>;
}

function RowValue({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

function RegionSubTrigger({
  country,
  label,
  active = false,
  value,
  count,
}: {
  country?: string;
  label: string;
  /** Draws the radio dot when the active base map is in this submenu. */
  active?: boolean;
  value?: string;
  count?: number;
}) {
  return (
    <DropdownMenuSubTrigger className={cn('relative pl-8', rowClass)}>
      {active && (
        <span
          className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"
          aria-hidden="true"
        >
          <span className="h-2 w-2 rounded-full bg-current" />
        </span>
      )}
      <RegionIcon country={country} />
      <RowText>{label}</RowText>
      {value && <RowValue>{value}</RowValue>}
      {!!count && (
        <span
          className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-secondary px-1.5 text-[11px] font-semibold text-secondary-foreground"
          aria-label={`${count} on`}
        >
          {count}
        </span>
      )}
    </DropdownMenuSubTrigger>
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
  const activeBaseMap = renderableBaseMap(baseMap);
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
        <SectionLabel>Base map</SectionLabel>
        <DropdownMenuRadioGroup
          value={activeBaseMap}
          onValueChange={(value) => setBaseMap(value as BaseMapId)}
        >
          {baseMapGroups.map((group) => {
            const maps = group.maps.filter(isBaseMapAvailable);
            if (!maps.length) return null;
            if (maps.length === 1) {
              const id = maps[0]!;
              return (
                <DropdownMenuRadioItem
                  key={group.id}
                  value={id}
                  className={rowClass}
                >
                  <RegionIcon country={group.country} />
                  <RowText>{group.label}</RowText>
                  {activeBaseMap === id && (
                    <RowValue>{baseMaps[id].label}</RowValue>
                  )}
                </DropdownMenuRadioItem>
              );
            }
            const active = maps.includes(activeBaseMap);
            return (
              <DropdownMenuSub key={group.id}>
                <RegionSubTrigger
                  country={group.country}
                  label={group.label}
                  active={active}
                  value={active ? baseMaps[activeBaseMap].label : undefined}
                />
                <PreferenceMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={activeBaseMap}
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
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <SectionLabel>Overlays</SectionLabel>
        {overlayGroups.map((group) => {
          const ids = group.overlays.filter(
            (id): id is OverlayId => id in overlayMapSettings,
          );
          if (!ids.length) return null;
          return (
            <DropdownMenuSub key={group.id}>
              <RegionSubTrigger
                country={group.country}
                label={group.label}
                count={ids.filter((id) => activeOverlays.includes(id)).length}
              />
              <PreferenceMenuSubContent>
                {ids.map((key) => (
                  <PreferenceMenuCheckboxItem
                    key={key}
                    checked={activeOverlays.includes(key)}
                    onCheckedChange={() => toggleOverlayMap(key)}
                  >
                    {overlayMapSettings[key].label}
                  </PreferenceMenuCheckboxItem>
                ))}
              </PreferenceMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        {(Object.keys(overlayMapSettings) as OverlayId[])
          .filter((key) => !groupedOverlayIDs.has(key))
          .map((key) => (
            <PreferenceMenuCheckboxItem
              key={key}
              checked={activeOverlays.includes(key)}
              onCheckedChange={() => toggleOverlayMap(key)}
              className={rowClass}
            >
              <span className="h-4 w-4 shrink-0" aria-hidden="true" />
              {overlayMapSettings[key].label}
            </PreferenceMenuCheckboxItem>
          ))}
      </PreferenceMenuContent>
    </DropdownMenu>
  );
}
