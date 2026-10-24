'use client';

import dynamic from 'next/dynamic';

import { usePlaceDebugAccess } from '~/hooks/use-place-debug';
import type { Activity } from '~/lib/activity';

import { MatchedPlacesLayer } from './matched-places-layer';

const PlaceDebugLayer = dynamic(
  () => import('./place-debug-layer').then((module) => module.PlaceDebugLayer),
  { ssr: false },
);

export function ActivityPlacesLayers(props: {
  activities: ReadonlyMap<number, Activity>;
  selectedIds: number[];
  highlighted: number;
}) {
  const access = usePlaceDebugAccess(false);
  return access.active && access.userId ? (
    <PlaceDebugLayer
      key={`${access.userId}:${access.authSession}`}
      {...props}
      userId={access.userId}
      authSession={access.authSession}
    />
  ) : (
    <MatchedPlacesLayer {...props} />
  );
}
