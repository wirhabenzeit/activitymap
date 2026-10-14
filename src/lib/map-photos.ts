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
const scalarCompare = (a: string, b: string) => {
  const aa = Array.from(a, (c) => c.codePointAt(0)!);
  const bb = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i]! - bb[i]!;
  }
  return aa.length - bb.length;
};

export function groupMapPhotos(
  points: ProjectedPhoto[],
  viewport: { width: number; height: number; zoom: number },
): MapPhotoGroup[] {
  if (
    !(viewport.width > 0 && viewport.height > 0) ||
    !Number.isFinite(viewport.zoom)
  )
    return [];
  const margin = mapPhotoPolicy.viewportMargin;
  const seen = new Set<string>();
  const visible = points
    .filter((p) => {
      if (
        seen.has(p.id) ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < -margin ||
        p.y < -margin ||
        p.x > viewport.width + margin ||
        p.y > viewport.height + margin
      )
        return false;
      seen.add(p.id);
      return true;
    })
    .sort((a, b) => scalarCompare(a.id, b.id));
  let spacing: number =
    viewport.zoom >= mapPhotoPolicy.thumbnailZoom
      ? mapPhotoPolicy.thumbnailSpacing
      : mapPhotoPolicy.pinSpacing;
  for (;;) {
    const groups: MapPhotoGroup[] = [];
    const cells = new Map<string, number[]>();
    for (const p of visible) {
      const cx = Math.floor(p.x / spacing),
        cy = Math.floor(p.y / spacing);
      let nearest: number | undefined;
      let distance = spacing * spacing;
      for (let x = cx - 1; x <= cx + 1; x++)
        for (let y = cy - 1; y <= cy + 1; y++) {
          for (const index of cells.get(`${x}:${y}`) ?? []) {
            const anchor = groups[index]!;
            const d = (p.x - anchor.x) ** 2 + (p.y - anchor.y) ** 2;
            if (
              d < distance ||
              (d === distance && (nearest === undefined || index < nearest))
            ) {
              nearest = index;
              distance = d;
            }
          }
        }
      if (nearest !== undefined) groups[nearest]!.photoIDs.push(p.id);
      else {
        const key = `${cx}:${cy}`;
        cells.set(key, [...(cells.get(key) ?? []), groups.length]);
        groups.push({ ...p, photoIDs: [p.id] });
      }
    }
    if (groups.length <= mapPhotoPolicy.maxMarkers) return groups;
    // Regroup instead of dropping photos when the viewport exceeds the budget.
    spacing *= 1.5;
  }
}
