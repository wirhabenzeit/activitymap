import assert from 'node:assert/strict';

import test from 'node:test';

import { clampPanelHeight, panelPercent, tapTarget } from './panel-bounds';

const bounds = { min: 72, max: 672 };

void test('panel height stays between the header and the tallest size', () => {
  assert.equal(clampPanelHeight(10, bounds), 72);
  assert.equal(clampPanelHeight(300.4, bounds), 300);
  assert.equal(clampPanelHeight(9000, bounds), 672);
  // A map too short for the header still yields a usable height.
  assert.equal(clampPanelHeight(500, { min: 72, max: 40 }), 72);
});

void test('panel percent is 0 collapsed, 100 expanded and proportional between', () => {
  assert.equal(panelPercent(72, bounds), 0);
  assert.equal(panelPercent(672, bounds), 100);
  assert.equal(panelPercent(372, bounds), 50);
  assert.equal(panelPercent(5000, bounds), 100);
  assert.equal(panelPercent(300, { min: 72, max: 72 }), 0);
});

void test('tapping the handle opens a collapsed panel and collapses any other', () => {
  assert.equal(tapTarget(72, bounds), 672);
  assert.equal(tapTarget(74, bounds), 72);
  assert.equal(tapTarget(372, bounds), 72);
  assert.equal(tapTarget(672, bounds), 72);
});
