import assert from 'node:assert/strict';

import test from 'node:test';

import {
  applyPlaceFilter,
  hutReason,
  passGroups,
  passNeedsTerrain,
  passReason,
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
    // Most cases are road passes; trail and off-road cases say so.
    ...(kinds.includes('pass') ? { pass_highways: ['tertiary'] } : {}),
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
    'Saddle',
    'Skaret',
    'перевал',
    '1557',
    '1557 m',
    'Forcella',
    'Joch',
    'sea',
    ' Passo ',
  ])
    assert.equal(
      passReason(pass(name, { pass_amp_m: 200 })),
      'generic_pass_name',
      name,
    );
  assert.equal(passReason(pass('Forcella', wikidata('Forcella'))), null);
  assert.equal(
    passReason(pass('Forcella Lavaredo', { pass_amp_m: 120 })),
    null,
  );
  assert.equal(passReason(pass('Passo 12', { pass_amp_m: 120 })), null);
});

void test('passes on minor roads need relief or a Wikipedia/Wikidata tag', () => {
  const road = (highways: string[], amp?: number) => ({
    pass_highways: highways,
    ...(amp === undefined ? {} : { pass_amp_m: amp }),
  });
  // Regensberger Pass: a local road over a low hill.
  assert.equal(
    passReason(pass('Regensberger Pass', road(['service', 'tertiary'], 23.3))),
    'low_relief_pass',
  );
  // Hulftegg: a minor road, but a real saddle.
  assert.equal(passReason(pass('Hulftegg', road(['tertiary'], 88.1))), null);
  // Ricken: a main road is a through route whatever the terrain.
  assert.equal(
    passReason(pass('Ricken', road(['primary', 'secondary'], 38.8))),
    null,
  );
  // Trail passes and passes on no way are real cols far more often than not.
  assert.equal(
    passReason(pass('Gerensattel', road(['path', 'track'], 11.9))),
    null,
  );
  assert.equal(passReason(pass('Forch', road([], 52.8))), null);
  assert.equal(
    passReason(
      pass('Ornpass', {
        ...road(['tertiary', 'unclassified'], 22.9),
        ...wikidata('Ornpass'),
      }),
    ),
    null,
  );
  assert.equal(
    passReason(
      pass('C', { ...road(['tertiary'], 5), tags: { wikipedia: 'de:C' } }),
    ),
    null,
  );
  // No terrain is no evidence.
  assert.equal(passReason(pass('Outside DEM', road(['tertiary']))), null);
  assert.equal(passReason(pass('Threshold', road(['tertiary'], 60))), null);
});

void test('terrain is measured only where a pass decision needs it', () => {
  assert.equal(
    passNeedsTerrain(pass('A', { pass_highways: ['tertiary'] })),
    true,
  );
  assert.equal(
    passNeedsTerrain(pass('A', { pass_highways: ['residential', 'service'] })),
    true,
  );
  for (const highways of [[], ['path'], ['primary', 'tertiary']])
    assert.equal(
      passNeedsTerrain(pass('A', { pass_highways: highways })),
      false,
      highways.join('+'),
    );
  assert.equal(passNeedsTerrain(pass('Ornpass', wikidata('Ornpass'))), false);
  assert.equal(passNeedsTerrain(pass('Sattel')), false);
});

void test('peaks are never hidden', () => {
  const bump = place(['peak'], 'Baldern');
  assert.equal(applyPlaceFilter([bump])[0]!.hidden_reason, undefined);
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
    'Vollaseter',
    'Bergerie de Lavu',
    'Auberge du Col',
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
    hutReason(hut('Vollaseter', { operator: 'Den Norske Turistforening' })),
    null,
  );
  assert.equal(hutReason(hut('Bergerie de Lavu', { operator: 'CAF' })), null);
  assert.equal(hutReason(hut('Hut Alm', { operator: 'DOC' })), null);
  assert.equal(
    hutReason(hut('Hochalm', { operator: 'Docteur Alm' })),
    'non_mountain_hut',
  );
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
    pass_amp_m: 47,
    location: { longitude: 9.0, latitude: 47.25 },
  });
  const b = pass('ricken', {
    pass_amp_m: 73,
    location: { longitude: 9.008, latitude: 47.25 },
  });
  const far = pass('Ricken', {
    pass_amp_m: 47,
    location: { longitude: 9.1, latitude: 47.25 },
  });
  const other = pass('Wasserfluh', {
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
  // A peak that is also mapped as a pass is always kept.
  const summit = place(['peak', 'pass'], 'Sattelkopf', { pass_amp_m: 10 });
  assert.equal(applyPlaceFilter([summit])[0]!.hidden_reason, undefined);
  const both = place(['pass', 'hut'], 'Passalm', { pass_amp_m: 10 });
  const hidden = applyPlaceFilter([both])[0]!;
  assert.equal(hidden.hidden_reason, 'low_relief_pass');
  assert.equal(
    applyPlaceFilter([{ ...both, tags: { ...both.tags, capacity: '12' } }])[0]!
      .hidden_reason,
    undefined,
  );
  // Reapplying clears a stale decision.
  assert.equal(
    applyPlaceFilter([{ ...hidden, pass_amp_m: 80 }])[0]!.hidden_reason,
    undefined,
  );
});
