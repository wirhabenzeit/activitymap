import { groupMapPoints } from './map-point-groups';

/** Screen-space policy shared with iOS (shared/parity/map-photos.v1.json).
 * Anchors remain real photo locations, including for coincident photo stacks.
 */
export const mapPhotoPolicy = {
  thumbnailZoom: 12,
  pinSpacing: 48,
  thumbnailSpacing: 72,
  viewportMargin: 44,
  maxMarkers: 80,
} as const;
export interface ProjectedPhoto {
  id: string;
  x: number;
  y: number;
}
export interface MapPhotoGroup extends ProjectedPhoto {
  photoIDs: string[];
}
export function groupMapPhotos(
  points: ProjectedPhoto[],
  viewport: { width: number; height: number; zoom: number },
): MapPhotoGroup[] {
  if (!Number.isFinite(viewport.zoom)) return [];
  return groupMapPoints(points, viewport, {
    ...mapPhotoPolicy,
    spacing:
      viewport.zoom >= mapPhotoPolicy.thumbnailZoom
        ? mapPhotoPolicy.thumbnailSpacing
        : mapPhotoPolicy.pinSpacing,
  }).map(({ pointIDs, ...group }) => ({ ...group, photoIDs: pointIDs }));
}
