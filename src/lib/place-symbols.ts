import type { MatchedPlace } from '~/contracts/activity-places';

export type PlaceKind = MatchedPlace['kinds'][number];

/** Font Awesome 6 Solid: mountain, road and house-chimney.
 * SVG geometry from react-icons/fa6, shared by UI and map sprites.
 * Font Awesome Free — https://fontawesome.com — icons licensed CC BY 4.0:
 * https://github.com/FortAwesome/Font-Awesome/blob/6.x/LICENSE.txt
 */
export const PLACE_SYMBOLS: Record<
  PlaceKind,
  { width: number; height: number; path: string }
> = {
  peak: {
    width: 512,
    height: 512,
    path: 'M256 32c12.5 0 24.1 6.4 30.8 17L503.4 394.4c5.6 8.9 8.6 19.2 8.6 29.7c0 30.9-25 55.9-55.9 55.9L55.9 480C25 480 0 455 0 424.1c0-10.5 3-20.8 8.6-29.7L225.2 49c6.6-10.6 18.3-17 30.8-17zm65 192L256 120.4 176.9 246.5l18.3 24.4c6.4 8.5 19.2 8.5 25.6 0l25.6-34.1c6-8.1 15.5-12.8 25.6-12.8l49 0z',
  },
  pass: {
    width: 576,
    height: 512,
    path: 'M256 32l-74.8 0c-27.1 0-51.3 17.1-60.3 42.6L3.1 407.2C1.1 413 0 419.2 0 425.4C0 455.5 24.5 480 54.6 480L256 480l0-64c0-17.7 14.3-32 32-32s32 14.3 32 32l0 64 201.4 0c30.2 0 54.6-24.5 54.6-54.6c0-6.2-1.1-12.4-3.1-18.2L455.1 74.6C446 49.1 421.9 32 394.8 32L320 32l0 64c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-64zm64 192l0 64c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32s32 14.3 32 32z',
  },
  hut: {
    width: 576,
    height: 512,
    path: 'M543.8 287.6c17 0 32-14 32-32.1c1-9-3-17-11-24L512 185l0-121c0-17.7-14.3-32-32-32l-32 0c-17.7 0-32 14.3-32 32l0 36.7L309.5 7c-6-5-14-7-21-7s-15 1-22 8L10 231.5c-7 7-10 15-10 24c0 18 14 32.1 32 32.1l32 0 0 69.7c-.1 .9-.1 1.8-.1 2.8l0 112c0 22.1 17.9 40 40 40l16 0c1.2 0 2.4-.1 3.6-.2c1.5 .1 3 .2 4.5 .2l31.9 0 24 0c22.1 0 40-17.9 40-40l0-24 0-64c0-17.7 14.3-32 32-32l64 0c17.7 0 32 14.3 32 32l0 64 0 24c0 22.1 17.9 40 40 40l24 0 32.5 0c1.4 0 2.8 0 4.2-.1c1.1 .1 2.2 .1 3.3 .1l16 0c22.1 0 40-17.9 40-40l0-16.2c.3-2.6 .5-5.3 .5-8.1l-.7-160.2 32 0z',
  },
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
  const glyph = PLACE_SYMBOLS[kind];
  const scale = Math.min(18 / glyph.width, 18 / glyph.height);
  context.translate(
    16 - (glyph.width * scale) / 2,
    16 - (glyph.height * scale) / 2,
  );
  context.scale(scale, scale);
  context.fillStyle = active ? '#ea580c' : '#0f766e';
  context.fill(new Path2D(glyph.path));
  return context.getImageData(0, 0, 64, 64);
}
