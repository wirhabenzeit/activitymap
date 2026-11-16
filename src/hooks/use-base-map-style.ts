'use client';

import type { StyleSpecification } from 'maplibre-gl';
import { useEffect, useState } from 'react';

import { loadBaseMapStyle } from '~/lib/map-style';
import { type BaseMapId, renderableBaseMap } from '~/settings/map';

type LoadedStyle = { id: BaseMapId; style: StyleSpecification | string };

const cache = new Map<BaseMapId, Promise<LoadedStyle>>();

const load = (id: BaseMapId): Promise<LoadedStyle> => {
  let pending = cache.get(id);
  if (!pending) {
    pending = loadBaseMapStyle(id).then((style) => ({ id, style }));
    // A failed chunk load must be retryable on the next switch.
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
};

/**
 * Resolves a catalogue base map to a MapLibre style. While a newly picked
 * style loads, the previous one stays on screen; `undefined` only before the
 * first style is ready. The same object is returned for repeated picks, so
 * the map does not reload an unchanged style.
 */
export function useBaseMapStyle(
  requested: BaseMapId,
): StyleSpecification | string | undefined {
  const id = renderableBaseMap(requested);
  const [loaded, setLoaded] = useState<LoadedStyle>();
  useEffect(() => {
    let current = true;
    load(id).then(
      (next) => {
        if (current) setLoaded(next);
      },
      (error: unknown) => {
        console.error(`Base map ${id} could not be loaded`, error);
      },
    );
    return () => {
      current = false;
    };
  }, [id]);
  return loaded?.style;
}
