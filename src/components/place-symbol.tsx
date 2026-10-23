import type { SVGProps } from 'react';

import { PLACE_SYMBOL_PATHS, type PlaceKind } from '~/lib/place-symbols';

export function PlaceSymbol({
  kind,
  ...props
}: SVGProps<SVGSVGElement> & { kind: PlaceKind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={PLACE_SYMBOL_PATHS[kind]} />
    </svg>
  );
}
