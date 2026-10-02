// Capture shared fixture scenarios using the production web screens in dev mode.
// No session or database writes. Start this checkout with `pnpm dev` first.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import polyline from '@mapbox/polyline';

const [runDir, baseURL = 'http://localhost:3000'] = process.argv.slice(2);
assert(runDir, 'Pass the gallery run directory');
const base = new URL(baseURL);
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'Only a local dev server is permitted');
const repo = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(repo, 'shared/gallery-scenarios.json')));
const libraryPath = process.env.ACTIVITYMAP_GALLERY_LIBRARY || join(repo, 'ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json');
const bytes = readFileSync(libraryPath);
const { activities } = JSON.parse(bytes);
const fixtureHash = createHash('sha256').update(bytes).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
function selected(items, filter, key) {
  if (!filter) return items;
  const names = filter.split(',');
  for (const name of names) assert(items.some((item) => item[key] === name), `Unknown ${key}: ${name}`);
  return items.filter((item) => names.includes(item[key]));
}
const scenes = selected(manifest.scenarios, process.env.ACTIVITYMAP_GALLERY_SCENES, 'id').filter((s) => s.webPath);
const variants = selected(manifest.variants, process.env.ACTIVITYMAP_GALLERY_VARIANTS, 'name');
for (const s of scenes) for (const id of [...s.selectedIDs, ...(s.detailID ? [s.detailID] : [])]) {
  assert(activities.some((a) => Number(a.id) === id), `Missing activity ${id} for ${s.id}`);
}
mkdirSync(runDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const v of variants) for (const [order, s] of scenes.entries()) {
    const started = Date.now();
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-CH', timezoneId: 'Europe/Zurich',
      colorScheme: v.dark ? 'dark' : 'light', serviceWorkers: 'block' });
    try {
      await context.addInitScript(({ activities, scenario, dark }) => {
        window.__ACTIVITYMAP_GALLERY__ = { activities, ...scenario };
        localStorage.setItem('theme', dark ? 'dark' : 'light');
        localStorage.setItem('activitymap-ui-state', JSON.stringify({ version: 1, state: {
          position: { longitude: 9.1, latitude: 46.95, zoom: 6.5, bearing: 0, pitch: 0 },
        } }));
      }, { activities, scenario: s, dark: v.dark });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(new URL(s.webPath, base).toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
      assert(response?.ok(), `Navigation failed for ${s.id}: ${response?.status()}`);
      await page.waitForFunction(() => window.__ACTIVITYMAP_GALLERY_READY__ === true, undefined, { timeout: 30_000 });
      // Browser text scaling is an accessibility stress case, not an exact
      // equivalent of iOS Dynamic Type. Both are labelled in capture metadata.
      if (v.largeText) await page.addStyleTag({ content: 'html { font-size: 24px !important; }' });
      await page.addStyleTag({ content: 'nextjs-portal, .tsqd-parent-container { display: none !important; }' });
      if (s.webPath === '/map') {
        await page.waitForFunction(() => !!window.__ACTIVITYMAP_GALLERY_MAP__, undefined, { timeout: 30_000 });
        if (s.selectedIDs.length) {
          const points = activities.filter((a) => s.selectedIDs.includes(Number(a.id)))
            .flatMap((a) => polyline.decode(a.map_polyline || a.map_summary_polyline || ''));
          assert(points.length, `No route geometry for ${s.id}`);
          const lats = points.map((p) => p[0]), lngs = points.map((p) => p[1]);
          await page.evaluate(({ bounds, height }) => window.__ACTIVITYMAP_GALLERY_MAP__.fitBounds(bounds,
            { duration: 0, padding: { top: 32, left: 32, right: 32, bottom: Math.round(height * 0.4) } }),
          { bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], height: v.height });
        }
        await page.waitForFunction(() => {
          const map = window.__ACTIVITYMAP_GALLERY_MAP__;
          return map?.loaded() && map.areTilesLoaded() && !map.isMoving();
        }, undefined, { timeout: 30_000 });
      } else {
        await page.getByRole('button', { name: 'Select row', exact: true }).first().waitFor();
      }
      if (s.id === 'list-detail') {
        const activity = activities.find((a) => Number(a.id) === s.detailID);
        await page.getByRole('row').filter({ has: page.getByText(activity.name, { exact: true }) }).first().click();
        await page.getByRole('button', { name: 'Collapse route details' }).waitFor();
      }
      if (s.id === 'filters') {
        const search = page.getByPlaceholder('Search activities');
        if (!await search.isVisible()) await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).first().click();
        await search.waitFor();
        assert.equal(await search.inputValue(), s.search);
      }
      await page.evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(errors.length, 0, `Page errors in ${s.id}: ${errors.join('; ')}`);
      const stem = `web-${s.id}--${v.name}`;
      await page.screenshot({ path: join(runDir, `${stem}.jpg`), type: 'jpeg', quality: 85, animations: 'disabled' });
      writeFileSync(join(runDir, `${stem}.json`), JSON.stringify({
        platform: 'web', scene: s.id, title: s.title, order, variant: v.name,
        width: v.width, height: v.height, dark: v.dark, library: libraryPath,
        fixtureHash, commit, selectedIDs: s.selectedIDs, detailID: s.detailID ?? null, search: s.search ?? '',
        basemap: 'mapbox', contentSize: v.largeText ? '150% browser text' : 'default',
        durationMs: Date.now() - started,
      }, null, 2));
      console.log(`captured ${stem} (${Date.now() - started} ms)`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
