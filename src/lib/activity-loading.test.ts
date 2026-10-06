import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceIndicator,
  hiddenIndicator,
  INDICATOR_MINIMUM_VISIBLE_MS,
  INDICATOR_SHOW_AFTER_MS,
  isActivityLoadBusy,
  type IndicatorState,
} from './activity-loading';

const pages = {
  isFetching: false,
  hasNextPage: false,
  isError: false,
  isFetchNextPageError: false,
};

void test('the gap between sequential pages stays busy', () => {
  assert.equal(isActivityLoadBusy({ ...pages, isFetching: true }, 'idle'), true);
  // ActivityStreamer requests the next page after the previous fetch stops.
  assert.equal(isActivityLoadBusy({ ...pages, hasNextPage: true }, 'idle'), true);
  assert.equal(isActivityLoadBusy(pages, 'ready'), false);
});

void test('failed pages and retry waits end the busy interval', () => {
  assert.equal(
    isActivityLoadBusy({ ...pages, hasNextPage: true, isFetchNextPageError: true }, 'idle'),
    false,
  );
  assert.equal(isActivityLoadBusy({ ...pages, hasNextPage: true, isError: true }, undefined), false);
  assert.equal(isActivityLoadBusy(pages, 'error'), false);
  assert.equal(isActivityLoadBusy(pages, 'offline'), false);
  assert.equal(isActivityLoadBusy(pages, 'syncing'), true);
});

const run = (steps: [busy: boolean, at: number][]) => {
  let state: IndicatorState = hiddenIndicator;
  return steps.map(([busy, at]) => {
    const next = advanceIndicator(state, busy, at);
    state = next.state;
    return next;
  });
};

void test('short loads never show the indicator', () => {
  const [start, end] = run([[true, 0], [false, INDICATOR_SHOW_AFTER_MS - 1]]);
  assert.equal(start?.state.visible, false);
  assert.equal(start?.wakeAt, INDICATOR_SHOW_AFTER_MS);
  assert.deepEqual(end?.state, hiddenIndicator);
});

void test('a multi-page load shows one uninterrupted indicator', () => {
  const steps = run([
    [true, 0],
    [true, INDICATOR_SHOW_AFTER_MS],
    [true, 900],
    [true, 1800],
    [false, 2000],
  ]);
  assert.deepEqual(steps.map((s) => s.state.visible), [false, true, true, true, false]);
  assert.equal(steps[1]?.state.shownAt, INDICATOR_SHOW_AFTER_MS);
  // Unchanged while busy: the same element keeps spinning.
  assert.equal(steps[3]?.state.shownAt, INDICATOR_SHOW_AFTER_MS);
});

void test('a visible indicator stays for its minimum time, then always ends', () => {
  const shown = INDICATOR_SHOW_AFTER_MS;
  const [, , early, late] = run([
    [true, 0],
    [true, shown],
    [false, shown + 100],
    [false, shown + INDICATOR_MINIMUM_VISIBLE_MS],
  ]);
  assert.equal(early?.state.visible, true);
  assert.equal(early?.wakeAt, shown + INDICATOR_MINIMUM_VISIBLE_MS);
  assert.deepEqual(late?.state, hiddenIndicator);
  assert.equal(late?.wakeAt, null);
});

void test('work resuming within the minimum time continues the same interval', () => {
  const shown = INDICATOR_SHOW_AFTER_MS;
  const [, , gap, resumed] = run([[true, 0], [true, shown], [false, shown + 50], [true, shown + 100]]);
  assert.equal(gap?.state.visible, true);
  assert.equal(resumed?.state.visible, true);
  assert.equal(resumed?.state.shownAt, shown);
});
