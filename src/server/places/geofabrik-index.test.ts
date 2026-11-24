import assert from 'node:assert/strict';

import test from 'node:test';

import {
  datedPbfUrl,
  epochCandidates,
  geofabrikFileSize,
  parseGeofabrikIndex,
  selectEpoch,
} from './geofabrik-index';
import { geofabrikIndexFixture } from './geofabrik-index.fixture';

void test('extracts are classified and named by region ID', () => {
  const index = parseGeofabrikIndex(geofabrikIndexFixture());
  const kinds = Object.fromEntries(
    index.extracts.map((extract) => [extract.region, extract.kind]),
  );
  assert.deepEqual(kinds, {
    europe: 'other',
    alpland: 'country',
    bergland: 'country',
    alps: 'other',
    'alpland-nord': 'subregion',
    'alpland-sued': 'subregion',
    ringland: 'country',
    'north-america': 'other',
    bigland: 'country',
    'bigland-west': 'subregion',
    'bigland-east': 'subregion',
    'bigland-coast': 'other',
  });
  const west = index.byRegion.get('bigland-west')!;
  assert.equal(west.id, 'bigland/west');
  assert.equal(west.parent, 'bigland');
  assert.deepEqual(west.bbox, [-120, 30, -110, 45]);
  assert.equal(
    west.poly,
    'https://download.geofabrik.de/north-america/bigland/west/west.poly',
  );
  assert.deepEqual(index.byRegion.get('alpland')!.countries, ['AL']);
});

void test('two extracts with one region ID, an unknown parent or a foreign URL fail', () => {
  const colliding = geofabrikIndexFixture();
  colliding.features.push({
    ...colliding.features.find(
      (feature) => feature.properties.id === 'bigland/west',
    )!,
    properties: {
      ...colliding.features.find(
        (feature) => feature.properties.id === 'bigland/west',
      )!.properties,
      id: 'bigland-west',
    },
  });
  assert.throws(
    () => parseGeofabrikIndex(colliding),
    /bigland\/west and bigland-west share region ID bigland-west/,
  );

  const orphan = geofabrikIndexFixture();
  orphan.features[1]!.properties.parent = 'atlantis';
  assert.throws(
    () => parseGeofabrikIndex(orphan),
    /alpland has an unknown parent/,
  );

  const mirror = geofabrikIndexFixture();
  mirror.features[1]!.properties.urls.pbf =
    'https://ftp.gwdg.de/pub/misc/openstreetmap/download.geofabrik.de/alpland-latest.osm.pbf';
  assert.throws(() => parseGeofabrikIndex(mirror));
});

void test('a dated PBF replaces -latest with the day', () => {
  const index = parseGeofabrikIndex(geofabrikIndexFixture());
  assert.equal(
    datedPbfUrl(index.byRegion.get('alpland')!, '261122'),
    'https://download.geofabrik.de/europe/alpland/alpland-261122.osm.pbf',
  );
  assert.throws(() =>
    datedPbfUrl(index.byRegion.get('alpland')!, '2026-11-22'),
  );
});

void test('epoch candidates start two days back, newest first', () => {
  assert.deepEqual(epochCandidates(new Date('2026-11-24T08:00:00Z')), [
    '261122',
    '261121',
    '261120',
    '261119',
    '261118',
    '261117',
  ]);
  assert.deepEqual(
    epochCandidates(new Date('2027-01-02T23:59:00Z')).slice(0, 2),
    ['261231', '261230'],
  );
});

void test('the epoch is the newest date every region has', async () => {
  const index = parseGeofabrikIndex(geofabrikIndexFixture());
  const extracts = ['alpland', 'bergland', 'bigland-west'].map((region) =>
    index.byRegion.get(region)!,
  );
  const available = new Set([
    'alpland-261122',
    'bergland-261122',
    'alpland-261121',
    'bergland-261121',
    'west-261121',
  ]);
  const exists = (url: string) =>
    Promise.resolve(available.has(/([a-z-]+-\d{6})\.osm\.pbf$/.exec(url)![1]!));
  assert.equal(
    await selectEpoch({
      extracts,
      dates: ['261122', '261121', '261120'],
      exists,
    }),
    '261121',
  );
  await assert.rejects(
    selectEpoch({ extracts, dates: ['261122'], exists }),
    /No date from 261122 to 261122 has every region's extract; missing on 261122: bigland-west/,
  );
  await assert.rejects(
    selectEpoch({ extracts, dates: ['261120', '261119'], exists }),
    /missing on 261119: alpland, bergland, bigland-west/,
  );
});

void test('file sizes come from HEAD on download.geofabrik.de, without redirects', async () => {
  const answer = (status: number, headers: Record<string, string> = {}) =>
    (async (_url: string | URL | Request, init?: RequestInit) => {
      assert.equal(init?.method, 'HEAD');
      assert.equal(init?.redirect, 'manual');
      return new Response(null, { status, headers });
    }) as typeof fetch;
  const url =
    'https://download.geofabrik.de/europe/alpland/alpland-261122.osm.pbf';
  assert.equal(
    await geofabrikFileSize(
      url,
      answer(200, { 'content-length': '5121099827' }),
    ),
    5_121_099_827,
  );
  assert.equal(await geofabrikFileSize(url, answer(404)), null);
  await assert.rejects(
    geofabrikFileSize(url, answer(307, { location: 'https://ftp.gwdg.de/x' })),
    /answered 307/,
  );
  await assert.rejects(
    geofabrikFileSize('https://example.org/x.osm.pbf', answer(200)),
  );
});
