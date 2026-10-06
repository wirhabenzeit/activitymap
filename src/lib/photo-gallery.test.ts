import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  orderedPhotos,
  photoVariant,
  validPhotoLocation,
} from './photo-gallery';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../shared/parity/photo-viewer.v1.json', import.meta.url),
    'utf8',
  ),
) as {
  variantCases: {
    name: string;
    urls: Record<string, string> | null;
    sizes: Record<string, [number, number]> | null;
    thumbnail: { url: string; width?: number; height?: number } | null;
    full: { url: string; width?: number; height?: number } | null;
  }[];
  orderCases: {
    name: string;
    photos: { id: string; created_at: string | null }[];
    expected_ids: string[];
  }[];
};
for (const c of fixture.variantCases) {
  void test(c.name, () => {
    for (const mode of ['thumbnail', 'full'] as const) {
      const actual = photoVariant(c, mode);
      assert.deepEqual(
        actual
          ? {
              url: actual.url,
              ...(actual.width !== undefined && {
                width: actual.width,
                height: actual.height,
              }),
            }
          : null,
        c[mode],
      );
    }
  });
}
for (const c of fixture.orderCases) {
  void test(c.name, () => {
    const photos = c.photos.map((p) => ({
      unique_id: p.id,
      created_at: p.created_at ? new Date(p.created_at) : null,
      urls: null,
      sizes: null,
    }));
    assert.deepEqual(
      orderedPhotos(photos).map((p) => p.unique_id),
      c.expected_ids,
    );
    assert.deepEqual(
      orderedPhotos([...photos].reverse()).map((p) => p.unique_id),
      c.expected_ids,
    );
  });
}
const coordinates = JSON.parse(
  readFileSync(
    new URL('../../shared/parity/activity-fixtures.v1.json', import.meta.url),
    'utf8',
  ),
) as {
  photoCases: {
    id: string;
    location: number[] | null;
    expected_marker: boolean;
  }[];
};
void test('shared map coordinates include equator, meridian and origin', () => {
  for (const c of coordinates.photoCases)
    assert.equal(validPhotoLocation(c.location), c.expected_marker, c.id);
  for (const bad of [
    [],
    [1],
    [1, 2, 3],
    [NaN, 0],
    [0, Infinity],
    [0, 181],
    [-91, 0],
  ])
    assert.equal(validPhotoLocation(bad), false);
});
