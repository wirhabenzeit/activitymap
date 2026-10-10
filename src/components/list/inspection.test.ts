import assert from 'node:assert/strict';
import test from 'node:test';
import { sortActivities } from '~/lib/activity-presentation';
import {
  activityURL,
  detailPresentation,
  inspectedActivity,
  inspectionStep,
} from './inspection';

void test('the panel threshold uses content width and restores the panel on widening', () => {
  for (const width of [402, 760 - 256, 759])
    assert.equal(detailPresentation(width), 'push');
  for (const width of [760, 1024 - 256, 1440 - 256])
    assert.equal(detailPresentation(width), 'panel');
  assert.deepEqual([1440 - 256, 759, 1440 - 256].map(detailPresentation), [
    'panel',
    'push',
    'panel',
  ]);
});

void test('stepping follows filtered sort order and crosses page boundaries both ways', () => {
  const data = [
    { id: 1, name: 'Zulu' },
    { id: 2, name: 'Bravo' },
    { id: 3, name: 'Hidden' },
    { id: 4, name: 'Alpha' },
    { id: 5, name: 'Charlie' },
  ];
  const rows = sortActivities(
    data.filter((row) => row.id !== 3),
    [{ id: 'name', desc: false }],
  ).map((row) => ({ ...row, id: String(row.id) }));
  assert.deepEqual(
    rows.map((row) => row.id),
    ['4', '2', '5', '1'],
  );
  assert.deepEqual(inspectionStep(rows, 2, 1, 2), {
    row: rows[2],
    pageIndex: 1,
  });
  assert.deepEqual(inspectionStep(rows, 5, -1, 2), {
    row: rows[1],
    pageIndex: 0,
  });
  assert.equal(inspectionStep(rows, 4, -1, 2), undefined);
  assert.equal(inspectionStep(rows, 1, 1, 2), undefined);
  assert.equal(inspectionStep(rows, 3, 1, 2), undefined);
  assert.equal(inspectionStep([], 1, 1, 200), undefined);
  const descending = [...rows].reverse();
  assert.equal(inspectionStep(descending, 1, 1, 200)?.row.id, '5');
});

void test('inspection URLs preserve unrelated query parameters and reject malformed identities', () => {
  assert.equal(
    activityURL('https://activitymap.cc/list?other=value#here', 123),
    '/list?other=value&activity=123#here',
  );
  assert.equal(
    activityURL('https://activitymap.cc/list?activity=123&other=value#here', 0),
    '/list?other=value#here',
  );
  assert.equal(inspectedActivity('activity=123'), 123);
  for (const value of ['', '0', '-1', 'NaN', '1.5', '1e3', '9007199254740992'])
    assert.equal(inspectedActivity(`activity=${value}`), 0);
});
