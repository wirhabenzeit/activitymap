import catalog from '../../shared/map-catalog.json';

export type BaseMapId = keyof typeof catalog.baseMaps;

export const baseMapGroups = catalog.baseMapGroups.map((group) => ({
  ...group,
  maps: group.maps as BaseMapId[],
}));

/** Preserve old shared links and saved selections after consolidating styles. */
export const canonicalBaseMap = (id: BaseMapId): BaseMapId =>
  (catalog.baseMapAliases as Partial<Record<BaseMapId, BaseMapId>>)[id] ?? id;

export const overlayGroups = catalog.overlayGroups;
export const groupedOverlayIDs: ReadonlySet<string> = new Set(
  overlayGroups.flatMap((group) => group.overlays),
);
