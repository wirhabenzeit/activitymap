import assert from 'node:assert/strict';

import test from 'node:test';
import { z } from 'zod';

import { artifactSource, placeId, placeRows } from './catalogue-publish';
import { createSyntheticCatalogue } from './catalogue.fixture';

void test('a place is named after its OpenStreetMap object', () => {
  const id = placeId({ osm_type: 'node', osm_id: '26863664' });
  assert.equal(id, placeId({ osm_type: 'node', osm_id: '26863664' }));
  assert.equal(z.uuid().safeParse(id).success, true);
  assert.equal(id[14], '5');
  assert.notEqual(id, placeId({ osm_type: 'way', osm_id: '26863664' }));
  assert.notEqual(id, placeId({ osm_type: 'node', osm_id: '26863665' }));
  // The ID is part of what clients and stored matches refer to: it must not
  // change with this code.
  assert.equal(id, '8154d608-bb20-59da-8cdc-b812f0a8783d');
});

void test('the rows sent are the listed places, in ID order, under stable IDs', async () => {
  const catalogue = createSyntheticCatalogue({ regionId: 'v1-places' });
  const rows = placeRows(catalogue);
  assert.equal(
    rows.length,
    catalogue.rows.filter((row) => !row.hidden_reason).length,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    rows.map((row) => row.id).sort(),
  );
  // A later extract with the same objects names them the same way.
  const later = createSyntheticCatalogue({
    regionId: 'v1-places',
    dataAsOf: '2026-11-01T00:00:00Z',
  });
  assert.notEqual(
    later.manifest.catalogue_snapshot_id,
    catalogue.manifest.catalogue_snapshot_id,
  );
  assert.deepEqual(
    placeRows(later).map((row) => row.id),
    rows.map((row) => row.id),
  );

  const source = artifactSource(catalogue);
  const { snapshotId, count } = await source.current();
  assert.equal(count, rows.length);
  const paged = [];
  for (let after = ''; ;) {
    const page = await source.places(snapshotId, after, 2);
    if (page.length === 0) break;
    paged.push(...page);
    after = page.at(-1)!.id;
  }
  assert.deepEqual(paged, rows);
  await assert.rejects(source.places('osm-places-v1:other', '', 2));
});
