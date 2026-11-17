import assert from 'node:assert/strict';

import test from 'node:test';

import catalog from '../../shared/map-catalog.json';
import { syncBuildingExtrusions } from './map-buildings';
import { baseMapGroups, canonicalBaseMap } from './map-catalog';

void test('grouped picker retains every Swiss map and merges the old Street 3D choice', () => {
  const ids = baseMapGroups.flatMap((group) => group.maps);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    baseMapGroups.find((group) => group.id === 'worldwide')?.maps,
    [
      'mapboxOutdoors',
      'mapboxStreet',
      'mapboxLight',
      'mapboxDark',
      'mapboxTopolight',
      'mapboxSatellite',
    ],
  );
  assert.equal(baseMapGroups[0]?.label, 'Worldwide');
  assert(!baseMapGroups.some((group) => group.id === 'imagery'));
  assert.deepEqual(
    baseMapGroups
      .find((group) => group.id === 'swisstopo')
      ?.maps.slice()
      .sort(),
    Object.keys(catalog.baseMaps)
      .filter((id) => id.startsWith('swisstopo'))
      .sort(),
  );
  assert(!ids.includes('mapboxStreet3d'));
  assert.equal(canonicalBaseMap('mapboxStreet3d'), 'mapboxStreet');
  assert.equal(canonicalBaseMap('swisstopoSatellite'), 'swisstopoSatellite');
  assert(
    catalog.baseMaps.swisstopoSatellite.url.includes(
      '/ch.swisstopo.imagerybasemap.vt/',
    ),
  );
});

void test('3D buildings follow tilt and are restored after a style replacement', () => {
  let layers = [
    { id: 'building-3d', type: 'fill-extrusion' },
    { id: 'roads', type: 'line' },
  ];
  const visibility = new Map<string, unknown>([['building-3d', 'none']]);
  const changed: string[] = [];
  const map = {
    getStyle: () => ({ layers }),
    getLayoutProperty: (id: string) => visibility.get(id),
    setLayoutProperty: (id: string, _name: string, value: unknown) => {
      visibility.set(id, value);
      changed.push(id);
    },
  } as unknown as Parameters<typeof syncBuildingExtrusions>[0];
  syncBuildingExtrusions(map, true);
  assert.equal(visibility.get('building-3d'), 'visible');
  syncBuildingExtrusions(map, true);
  assert.deepEqual(changed, ['building-3d']);
  // A new style starts with hidden buildings and a different layer ID.
  layers = [
    { id: 'new-buildings', type: 'fill-extrusion' },
    { id: 'roads', type: 'line' },
  ];
  syncBuildingExtrusions(map, true);
  assert.equal(visibility.get('new-buildings'), 'visible');
  syncBuildingExtrusions(map, false);
  assert.equal(visibility.get('new-buildings'), 'none');
  assert(!changed.includes('roads'));
});

void test('Swiss overlay submenu contains exactly the four Swiss toggles', async () => {
  const { overlayGroups, groupedOverlayIDs } = await import('./map-catalog');
  assert.deepEqual(overlayGroups[0]?.overlays, [
    'swisstopoSki',
    'swisstopoSlope',
    'veloland',
    'wanderland',
  ]);
  assert(!groupedOverlayIDs.has('nveAvalanche'));
  assert(!groupedOverlayIDs.has('friflytToppturer'));
});
