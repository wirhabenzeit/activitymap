/** Deterministic screen-space grouping with real point anchors and no dropped counts. */
export interface ProjectedMapPoint {
  id: string;
  x: number;
  y: number;
}
export interface MapPointGroup extends ProjectedMapPoint {
  pointIDs: string[];
}
const scalarCompare = (a: string, b: string) => {
  const aa = Array.from(a, (c) => c.codePointAt(0)!);
  const bb = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i]! - bb[i]!;
  }
  return aa.length - bb.length;
};

export function groupMapPoints(
  points: ProjectedMapPoint[],
  viewport: { width: number; height: number },
  policy: { spacing: number; viewportMargin: number; maxMarkers: number },
): MapPointGroup[] {
  if (
    !(viewport.width > 0 && viewport.height > 0) ||
    !Number.isFinite(policy.spacing) ||
    policy.spacing <= 0 ||
    policy.maxMarkers < 1
  )
    return [];
  const margin = policy.viewportMargin;
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
  let spacing = policy.spacing;
  for (;;) {
    const groups: MapPointGroup[] = [];
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
      if (nearest !== undefined) groups[nearest]!.pointIDs.push(p.id);
      else {
        const key = `${cx}:${cy}`;
        cells.set(key, [...(cells.get(key) ?? []), groups.length]);
        groups.push({ ...p, pointIDs: [p.id] });
      }
    }
    if (groups.length <= policy.maxMarkers) return groups;
    // Regroup instead of dropping points when the viewport exceeds the budget.
    spacing *= 1.5;
  }
}
