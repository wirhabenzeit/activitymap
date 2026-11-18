import catalog from '../../shared/map-catalog.json';

export type BaseMapId = keyof typeof catalog.baseMaps;

export const baseMapGroups = catalog.baseMapGroups.map((group) => ({
  ...group,
  country: 'country' in group ? group.country : undefined,
  maps: group.maps as BaseMapId[],
}));

/** Preserve old shared links and saved selections after consolidating styles. */
export const canonicalBaseMap = (id: BaseMapId): BaseMapId =>
  (catalog.baseMapAliases as Partial<Record<BaseMapId, BaseMapId>>)[id] ?? id;

/** Web-native overlays (not in the shared catalogue) join a shared group here. */
const webOverlayGroupAdditions: Partial<Record<string, string[]>> = {
  norway: ['friflytToppturer'],
};

export const overlayGroups = catalog.overlayGroups.map((group) => ({
  ...group,
  country: 'country' in group ? group.country : undefined,
  overlays: [...group.overlays, ...(webOverlayGroupAdditions[group.id] ?? [])],
}));
export const groupedOverlayIDs: ReadonlySet<string> = new Set(
  overlayGroups.flatMap((group) => group.overlays),
);
