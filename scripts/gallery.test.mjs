import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const repo = resolve(import.meta.dirname, '..');
const builder = join(repo, 'scripts/build-gallery-index.mjs');
function shot(dir, stem, metadata) {
  writeFileSync(join(dir, `${stem}.jpg`), 'image');
  writeFileSync(join(dir, `${stem}.json`), JSON.stringify({ scene: 'list', title: 'List', variant: 'phone', width: 402, height: 874, order: 0, ...metadata }));
}
test('pairs both platforms in one figure, keeps unmatched scenes separate, and loads images lazily', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-pair-'));
  try {
    shot(dir, 'list--phone', { fixtureHash: 'same', selectedIDs: [1] });
    shot(dir, 'web-list--phone', { platform: 'web', fixtureHash: 'same', selectedIDs: [1] });
    shot(dir, 'native-only--phone', { scene: 'native-only', title: 'Native-only scene' });
    shot(dir, 'web-only--phone', { platform: 'web', scene: 'web-only', title: 'Web-only scene' });
    execFileSync(process.execPath, [builder, dir]);
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const list = html.match(/<section><h2>List<\/h2>(.*?)<\/section>/s)[1];
    assert.equal((list.match(/<figure/g) || []).length, 1);
    assert.match(list, /<span>iOS<\/span>.*<span>Web<\/span>/s);
    assert.match(list, /Shared fixture and activity state/);
    assert.match(html, /Web: no capture for this scenario/);
    assert.match(html, /iOS: no capture for this scenario/);
    assert.match(html, /loading="lazy"/);
    assert.doesNotMatch(html, /data:image/);
  } finally { rmSync(dir, { recursive: true }); }
});
test('mismatched selection cannot be labelled comparable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-state-'));
  try {
    shot(dir, 'list--phone', { fixtureHash: 'same', selectedIDs: [1] });
    shot(dir, 'web-list--phone', { platform: 'web', fixtureHash: 'same', selectedIDs: [] });
    execFileSync(process.execPath, [builder, dir]);
    assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /Not comparable: fixture or scenario state differs/);
  } finally { rmSync(dir, { recursive: true }); }
});
test('unknown scenario is rejected before an expensive build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-config-'));
  try {
    const result = spawnSync(process.execPath, [join(repo, 'scripts/gallery-config.mjs'), dir,
      join(repo, 'ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json'), 'typo'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown gallery selection: typo/);
  } finally { rmSync(dir, { recursive: true }); }
});
test('runner refuses to overwrite an existing capture run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-immutable-'));
  try {
    const marker = join(dir, 'preserve.txt');
    writeFileSync(marker, 'keep');
    const result = spawnSync('bash', [join(repo, 'scripts/ios-gallery.sh'), dir.split('/').at(-1), '--web-only'], {
      env: { ...process.env, ACTIVITYMAP_GALLERY_ROOT: resolve(dir, '..') }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Run already exists/);
    assert.equal(readFileSync(marker, 'utf8'), 'keep');
  } finally { rmSync(dir, { recursive: true }); }
});
test('incomplete platform coverage fails verification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-coverage-'));
  try {
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ scenarios: ['list'], variants: ['phone'] }));
    const result = spawnSync(process.execPath, [join(repo, 'scripts/verify-gallery.mjs'), dir, 'web'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing capture: web-list--phone/);
  } finally { rmSync(dir, { recursive: true }); }
});
