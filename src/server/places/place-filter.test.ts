import assert from 'node:assert/strict';

import test from 'node:test';

import {
  applyPlaceFilter,
  hutReason,
  passGroups,
  passReason,
  peakReason,
} from './place-filter';
import type { NormalizedPlace } from './types';

let nextId = 1;
function place(
  kinds: NormalizedPlace['kinds'],
  name: string,
  fields: Partial<NormalizedPlace> = {},
): NormalizedPlace {
  const subtypes: NormalizedPlace['subtypes'] = kinds.map((kind) =>
    kind === 'pass'
      ? 'road_trail_pass'
      : kind === 'hut'
        ? 'alpine_hut'
        : 'peak',
  );
  return {
    osm_type: 'node',
    osm_id: String(nextId++),
    kinds,
    subtypes,
    display_name: name,
    names: { name },
    location: { longitude: 8.7, latitude: 47.3 },
    tags: { name },
    osm_version: 1,
    osm_updated_at: '2026-10-20T00:00:00Z',
    point_derivation: 'osm_node',
    normalization_version: 'osm-places-v2',
    catalogue_snapshot_id: 'test',
    ...fields,
  };
}
const pass = (name: string, fields: Partial<NormalizedPlace> = {}) =>
  place(['pass'], name, fields);
const wikidata = (name: string) => ({ tags: { name, wikidata: 'Q1' } });

void test('passes with elevation-only or generic names are hidden unless notable', () => {
  for (const name of [
    'q. 2699',
    'P2650',
    'Pt. 2345',
    '1557',
    '1557 m',
    'Forcella',
    'Joch',
    'sea',
    ' Passo ',
  ])
    assert.equal(
      passReason(pass(name, { elevation_m: 2_500, pass_amp_m: 200 })),
      'generic_pass_name',
      name,
    );
  assert.equal(passReason(pass('Forcella', wikidata('Forcella'))), null);
  assert.equal(
    passReason(pass('Forcella Lavaredo', { elevation_m: 2_454 })),
    null,
  );
  assert.equal(passReason(pass('Passo 12', { elevation_m: 2_000 })), null);
});

void test('low passes need relief or a Wikipedia/Wikidata tag', () => {
  // Forch: a lowland road crossing.
  assert.equal(
    passReason(pass('Forch', { elevation_m: 680, pass_amp_m: 21 })),
    'low_relief_pass',
  );
  // Hulftegg: low, but a real saddle.
  assert.equal(
    passReason(pass('Hulftegg', { elevation_m: 953, pass_amp_m: 95 })),
    null,
  );
  // Furkapass: high.
  assert.equal(
    passReason(pass('Furkapass', { elevation_m: 2_429, pass_amp_m: 10 })),
    null,
  );
  // DEM height when OSM has no `ele`; OSM `ele` wins when both exist.
  assert.equal(
    passReason(pass('A', { dem_elevation_m: 1_250, pass_amp_m: 0 })),
    null,
  );
  assert.equal(
    passReason(
      pass('B', { elevation_m: 900, dem_elevation_m: 1_250, pass_amp_m: 0 }),
    ),
    'low_relief_pass',
  );
  assert.equal(
    passReason(
      pass('Ornpass', {
        elevation_m: 700,
        pass_amp_m: 5,
        ...wikidata('Ornpass'),
      }),
    ),
    null,
  );
  assert.equal(
    passReason(
      pass('C', {
        elevation_m: 700,
        pass_amp_m: 5,
        tags: { wikipedia: 'de:C' },
      }),
    ),
    null,
  );
  // No terrain is no evidence.
  assert.equal(passReason(pass('Outside DEM', { elevation_m: 300 })), null);
  assert.equal(
    passReason(pass('Threshold', { elevation_m: 800, pass_amp_m: 60 })),
    null,
  );
});

void test('peaks under 30 m local prominence are hidden unless notable or capped', () => {
  const peak = (fields: Partial<NormalizedPlace>) =>
    place(['peak'], 'Bump', fields);
  assert.equal(
    peakReason(peak({ peak_prominence_m: 12, peak_prominence_capped: false })),
    'low_prominence_peak',
  );
  assert.equal(
    peakReason(peak({ peak_prominence_m: 30, peak_prominence_capped: false })),
    null,
  );
  assert.equal(
    peakReason(peak({ peak_prominence_m: 12, peak_prominence_capped: true })),
    null,
  );
  assert.equal(
    peakReason(
      peak({
        peak_prominence_m: 12,
        peak_prominence_capped: false,
        ...wikidata('Bump'),
      }),
    ),
    null,
  );
  assert.equal(peakReason(peak({})), null);
});

void test('huts named as Alm, inn or forestry hut are hidden without club or info tags', () => {
  const hut = (name: string, tags: Record<string, string> = {}) =>
    place(['hut'], name, { tags: { name, ...tags } });
  for (const name of [
    'Hochalm',
    'Obere Alm',
    'Alpe Devero',
    'Malga Fossetta',
    'Casera Razzo',
    'Baita Segantini',
    'Gasthaus Edelweiss',
    'Albergo Monte',
    'Ristoro Tre Cime',
    'Forsthütte',
    'Jagdhütte am Bach',
    'Bergrestaurant',
  ])
    assert.equal(hutReason(hut(name)), 'non_mountain_hut', name);
  assert.equal(
    hutReason(hut('Hochalm', { operator: 'DAV Sektion München' })),
    null,
  );
  assert.equal(
    hutReason(hut('Malga Fossetta', { operator: 'CAI Feltre' })),
    null,
  );
  assert.equal(hutReason(hut('Hochalm', { capacity: '20' })), null);
  assert.equal(
    hutReason(hut('Hochalm', { 'contact:website': 'https://example.invalid' })),
    null,
  );
  assert.equal(hutReason(hut('Hochalm', { wikidata: 'Q1' })), null);
  for (const name of [
    'Bivacco Plassa Gerù',
    'Scaletta-Schutzhütte',
    'Almagellerhütte',
    'Palmhütte',
  ])
    assert.equal(hutReason(hut(name)), null, name);
});

void test('same-name passes within 1 km share one decision', () => {
  // Ricken: duplicate nodes 600 m apart scored 47 and 73 m.
  const a = pass('Ricken', {
    elevation_m: 790,
    pass_amp_m: 47,
    location: { longitude: 9.0, latitude: 47.25 },
  });
  const b = pass('ricken', {
    elevation_m: 790,
    pass_amp_m: 73,
    location: { longitude: 9.008, latitude: 47.25 },
  });
  const far = pass('Ricken', {
    elevation_m: 790,
    pass_amp_m: 47,
    location: { longitude: 9.1, latitude: 47.25 },
  });
  const other = pass('Wasserfluh', {
    elevation_m: 845,
    pass_amp_m: 20,
    location: { longitude: 9.0, latitude: 47.25 },
  });
  assert.deepEqual(
    passGroups([a, b, far, other]).map((group) => group.sort()),
    [[0, 1], [2], [3]],
  );
  const filtered = applyPlaceFilter([a, b, far, other]);
  assert.deepEqual(
    filtered.map((row) => row.hidden_reason),
    [undefined, undefined, 'low_relief_pass', 'low_relief_pass'],
  );
});

void test('a place is hidden only when every kind is hidden', () => {
  const both = place(['peak', 'pass'], 'Sattelkopf', {
    elevation_m: 900,
    pass_amp_m: 80,
    peak_prominence_m: 5,
    peak_prominence_capped: false,
  });
  assert.equal(applyPlaceFilter([both])[0]!.hidden_reason, undefined);
  const hidden = applyPlaceFilter([{ ...both, pass_amp_m: 10 }])[0]!;
  assert.equal(hidden.hidden_reason, 'low_prominence_peak');
  // Reapplying clears a stale decision.
  assert.equal(
    applyPlaceFilter([{ ...hidden, peak_prominence_m: 50 }])[0]!.hidden_reason,
    undefined,
  );
});
