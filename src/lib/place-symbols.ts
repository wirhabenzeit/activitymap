import type { MatchedPlace } from '~/contracts/activity-places';

import symbols from '../../shared/places/symbols.json';

export type PlaceKind = MatchedPlace['kinds'][number];

/** The same 24pt geometry generates the native SwiftUI symbols. */
export const PLACE_SYMBOLS = Object.fromEntries(
  Object.entries(symbols).map(([kind, symbol]) => [
    kind,
    {
      width: 24,
      height: 24,
      path: symbol.commands.map((command) => command.join(' ')).join(' '),
      strokeWidth: symbol.strokeWidth,
    },
  ]),
) as Record<
  PlaceKind,
  { width: number; height: number; path: string; strokeWidth: number }
>;

/** Keep the chart circles 4px above the profile. */
export function placeChartSymbol(kind: PlaceKind) {
  const { chartSize: size, chartDiameter: diameter } = symbols[kind];
  return { size, diameter, offset: 4 + diameter / 2 };
}

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
  context.arc(16, 16, placeChartSymbol(kind).diameter / 2, 0, Math.PI * 2);
  const theme = getComputedStyle(document.documentElement);
  const foreground =
    'hsl(' + theme.getPropertyValue('--foreground').trim() + ')';
  const background =
    'hsl(' + theme.getPropertyValue('--background').trim() + ')';
  context.fillStyle = active
    ? theme.getPropertyValue('--activity-accent').trim()
    : foreground;
  context.fill();
  const glyph = PLACE_SYMBOLS[kind];
  const size = placeChartSymbol(kind).size;
  const scale = Math.min(size / glyph.width, size / glyph.height);
  context.translate(
    16 - (glyph.width * scale) / 2,
    16 - (glyph.height * scale) / 2,
  );
  context.scale(scale, scale);
  context.fillStyle = active ? '#ffffff' : background;
  const path = new Path2D(glyph.path);
  if (glyph.strokeWidth) {
    context.strokeStyle = context.fillStyle;
    context.lineWidth = glyph.strokeWidth;
    context.lineCap = context.lineJoin = 'round';
    context.stroke(path);
  } else {
    context.fill(path);
  }
  return context.getImageData(0, 0, 64, 64);
}
