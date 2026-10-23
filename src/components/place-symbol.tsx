import type { SVGProps } from 'react';

import { PLACE_SYMBOLS, type PlaceKind } from '~/lib/place-symbols';

export function PlaceSymbol({
  kind,
  ...props
}: SVGProps<SVGSVGElement> & { kind: PlaceKind }) {
  const glyph = PLACE_SYMBOLS[kind];
  return (
    <svg
      viewBox={'0 0 ' + glyph.width + ' ' + glyph.height}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d={glyph.path} />
    </svg>
  );
}
