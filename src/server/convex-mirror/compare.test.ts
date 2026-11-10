import assert from 'node:assert/strict';

import test from 'node:test';

import { createComparison } from './compare';

const route = (offset: number) => ({
  data: [
    [47.3769 + offset, 8.5417],
    [47.3771 + offset, 8.5423],
  ],
});
const summary = (latlng: unknown) => ({
  activity_id: '1',
  summary: { points: 2, latlng },
});
const examples = (left: unknown[], right: unknown[]) => {
  const comparison = createComparison();
  comparison.compareItems(
    'summary',
    left,
    right,
    (item) => (item as { activity_id: string }).activity_id,
  );
  return comparison.differences();
};

void test('differing coordinates are reported without their values', () => {
  const differences = examples([summary(route(0))], [summary(route(0.01))]);
  const fields = Object.keys(differences);
  assert.equal(fields.length, 1);
  assert.match(fields[0]!, /^summary\.summary\.latlng/);
  const text = JSON.stringify(differences);
  assert.doesNotMatch(text, /47\.3|8\.54/);
  assert.match(
    differences[fields[0]!]!.example,
    /^1: <\d+ chars> != <\d+ chars>$/,
  );
});

void test('an object compared with null is shown without its private parts', () => {
  const differences = examples(
    [{ activity_id: '1', summary: { points: 2, latlng: route(0) } }],
    [{ activity_id: '1', summary: null }],
  );
  assert.deepEqual(Object.keys(differences), ['summary.summary']);
  const { example } = differences['summary.summary']!;
  assert.doesNotMatch(example, /47\.3|8\.54/);
  // What is not private still identifies the difference.
  assert.match(example, /"points":2/);
  assert.match(example, /"latlng":"<\d+ chars>"/);
  assert.match(example, / != null$/);
});

void test('private values nested in lists and photo fields are hidden', () => {
  const comparison = createComparison();
  comparison.compare(
    'activity',
    '1',
    { segments: [{ name: 'Climb', start_latlng: [47.1, 8.1] }] },
    { segments: null },
  );
  comparison.compare(
    'photo',
    'p',
    { urls: { '600': 'https://photos.invalid/secret' }, caption: 'Summit' },
    { urls: { '600': 'https://photos.invalid/other' }, caption: 'Ridge' },
  );
  const text = JSON.stringify(comparison.differences());
  assert.doesNotMatch(text, /47\.1|secret|other|Summit|Ridge/);
  assert.match(text, /Climb/);
});
