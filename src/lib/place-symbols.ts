import type { MatchedPlace } from '~/contracts/activity-places';

export type PlaceKind = MatchedPlace['kinds'][number];

/** Shared geometry for map sprites and profile/UI symbols (24 × 24 view box). */
export const PLACE_SYMBOL_PATHS: Record<PlaceKind, string> = {
  peak: 'M3 20 12 4 21 20Z M8.6 10 12 13 15.4 10',
  pass: 'M3 5C7 5 7 15 12 15S17 5 21 5 M3 21C7 21 7 17 12 17S17 21 21 21',
  hut: 'M3 11 12 4 21 11 M5 10V21H19V10 M10 21V15H14V21',
};

/** Stable precedence for the rare source supporting more than one relation. */
export function primaryPlaceKind(
  place: Pick<MatchedPlace, 'kinds'>,
): PlaceKind {
  return place.kinds.includes('peak')
    ? 'peak'
    : place.kinds.includes('pass')
      ? 'pass'
      : 'hut';
}

export function placeSymbolId(kind: PlaceKind, active: boolean) {
  return 'matched-place-' + kind + (active ? '-active' : '');
}

/** Six tiny, local sprites per map style; no external icons or per-place DOM. */
export function placeSymbolImage(kind: PlaceKind, active: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.scale(2, 2);
  context.beginPath();
  context.arc(16, 16, 13, 0, Math.PI * 2);
  context.fillStyle = '#ffffff';
  context.fill();
  context.strokeStyle = active ? '#f97316' : '#d1d5db';
  context.lineWidth = active ? 2 : 1;
  context.stroke();
  context.translate(7, 7);
  context.scale(0.75, 0.75);
  context.strokeStyle = active ? '#ea580c' : '#0f766e';
  context.lineWidth = 2;
  context.lineJoin = context.lineCap = 'round';
  context.stroke(new Path2D(PLACE_SYMBOL_PATHS[kind]));
  return context.getImageData(0, 0, 64, 64);
}
