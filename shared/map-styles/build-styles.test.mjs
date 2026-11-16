import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import test from 'node:test';

import { buildStyle, profiles, resolveStyleKey } from './build-styles.mjs';

const read = (file) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const upstream = Object.fromEntries(
  [...new Set(Object.values(profiles).map((p) => p.base))].map((base) => [
    base,
    read(`upstream/${base}.json`),
  ]),
);
const trails = read('outdoor-trail-paint.json');
const build = (id) => buildStyle(id, upstream, trails);

test('all seven legacy catalogue IDs have independent, Mapbox-free templates', () => {
  const catalogue = read('../map-catalog.json');
  const original = JSON.stringify(upstream);
  assert.deepEqual(
    Object.keys(profiles).sort(),
    Object.keys(catalogue.baseMaps)
      .filter((id) => id.startsWith('mapbox'))
      .sort(),
  );
  for (const id of Object.keys(profiles)) {
    const style = build(id);
    assert.equal(style.version, 8);
    assert.equal(
      new Set(style.layers.map((l) => l.id)).size,
      style.layers.length,
    );
    for (const l of style.layers)
      if (l.source)
        assert(style.sources[l.source], `${id}: ${l.id} has a missing source`);
    assert(!JSON.stringify(style).includes('mapbox://'));
    assert(!JSON.stringify(style).includes('pk.ey'));
  }
  assert.equal(JSON.stringify(upstream), original);
});

test('key resolution covers glyphs, vector sources and every sprite, without mutating the template', () => {
  const template = build('mapboxOutdoors');
  assert.throws(() => resolveStyleKey(template), /requires a MapTiler/);
  const style = resolveStyleKey(template, 'fixture key');
  assert(style.glyphs.includes('key=fixture%20key'));
  assert(style.sources.contours.url.includes('key=fixture%20key'));
  assert(
    style.sprite.every((entry) => entry.url.includes('key=fixture%20key')),
  );
  assert(!JSON.stringify(style).includes('{MAPTILER_KEY}'));
  assert(JSON.stringify(template).includes('{MAPTILER_KEY}'));
  assert(
    !JSON.stringify(resolveStyleKey(build('mapboxStreet'))).includes('key='),
  );
});

test('Street 3D uses real OMT heights while regular Street remains flat', () => {
  const layer = build('mapboxStreet3d').layers.find(
    (l) => l.id === 'building-3d',
  );
  assert.equal(layer.layout.visibility, 'visible');
  assert(
    JSON.stringify(layer.paint['fill-extrusion-height']).includes(
      'render_height',
    ),
  );
  assert.equal(
    build('mapboxStreet').layers.find((l) => l.id === layer.id).layout
      .visibility,
    'none',
  );
});

test('Topolight supplies independent hillshade and Satellite stays imagery-only', () => {
  const topo = build('mapboxTopolight');
  assert.equal(topo.sources['activitymap-dem'].encoding, 'terrarium');
  assert(topo.layers.some((l) => l.type === 'hillshade'));
  assert(!JSON.stringify(topo).includes('maptiler.com'));
  const satellite = build('mapboxSatellite');
  assert(satellite.layers.some((l) => l.type === 'raster'));
  assert(
    satellite.layers.every((l) => ['raster', 'background'].includes(l.type)),
  );
  assert.equal(satellite.glyphs, undefined);
});

test('an upstream layer rename fails instead of silently losing a requested treatment', () => {
  const changed = structuredClone(upstream);
  changed.outdoor.layers = changed.outdoor.layers.filter(
    (l) => l.id !== 'Red trail',
  );
  assert.throws(
    () => buildStyle('mapboxOutdoors', changed, trails),
    /Missing upstream layer: Red trail/,
  );
});
