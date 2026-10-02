// Fail incomplete runs instead of publishing a deceptively successful gallery.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [dir, platforms = 'ios,web'] = process.argv.slice(2);
const run = JSON.parse(readFileSync(join(dir, 'run.json')));
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../shared/gallery-scenarios.json')));
for (const platform of platforms.split(',')) for (const id of run.scenarios) {
  const scenario = manifest.scenarios.find((s) => s.id === id);
  if (platform === 'web' && !scenario.webPath) continue;
  for (const name of run.variants) {
    const stem = `${platform === 'web' ? 'web-' : ''}${id}--${name}`;
    assert(existsSync(join(dir, `${stem}.jpg`)), `Missing capture: ${stem}`);
    const capture = JSON.parse(readFileSync(join(dir, `${stem}.json`)));
    const variant = manifest.variants.find((v) => v.name === name);
    assert.equal(capture.fixtureHash, run.fixtureHash, `Wrong fixture: ${stem}`);
    assert.deepEqual(capture.selectedIDs, scenario.selectedIDs, `Wrong selection: ${stem}`);
    assert.equal(capture.detailID ?? null, scenario.detailID ?? null, `Wrong detail: ${stem}`);
    assert.equal(capture.search ?? '', scenario.search ?? '', `Wrong search: ${stem}`);
    assert.equal(capture.width, variant.width, `Wrong width: ${stem}`);
    assert.equal(capture.height, variant.height, `Wrong height: ${stem}`);
    assert.equal(capture.dark, variant.dark, `Wrong theme: ${stem}`);
  }
}
