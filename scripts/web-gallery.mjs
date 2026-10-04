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
      // Detail follows the real List → Show on map action, including navigation.
      const response = await page.goto(new URL(s.id === 'map-detail' ? '/list' : s.webPath, base).toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
      assert(response?.ok(), `Navigation failed for ${s.id}: ${response?.status()}`);
      await page.waitForFunction(() => window.__ACTIVITYMAP_GALLERY_READY__ === true, undefined, { timeout: 30_000 });
      // Browser text scaling is an accessibility stress case, not an exact
      // equivalent of iOS Dynamic Type. Both are labelled in capture metadata.
      if (v.largeText) await page.addStyleTag({ content: 'html { font-size: 24px !important; }' });
      await page.addStyleTag({ content: 'nextjs-portal, .tsqd-parent-container { display: none !important; }' });
      let framing;
      if (s.webPath === '/map') {
        if (s.id === 'map-detail') {
          const activity = activities.find((a) => Number(a.id) === s.detailID);
          await page.getByRole('button', { name: `Show ${activity.name} on map`, exact: true }).click();
        }
        await page.waitForFunction(() => !!window.__ACTIVITYMAP_GALLERY_MAP__, undefined, { timeout: 30_000 });
        if (s.id === 'map-results') {
          await page.getByRole('button', { name: 'Fit selected routes', exact: true }).click();
        }
        await page.waitForFunction(() => {
          const map = window.__ACTIVITYMAP_GALLERY_MAP__;
          return map?.loaded() && map.areTilesLoaded() && !map.isMoving()
            && !document.querySelector('[data-route-fit="pending"]');
        }, undefined, { timeout: 30_000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          let previous = '', stableSince = performance.now();
          const started = performance.now();
          await new Promise((resolve, reject) => {
            function check() {
              const map = window.__ACTIVITYMAP_GALLERY_MAP__;
              const frame = JSON.stringify([map.getCenter(), map.getZoom(), map.getPadding(),
                map.getContainer().getBoundingClientRect(), document.querySelector('#map-route-panel')?.getBoundingClientRect()]);
              if (frame !== previous) { previous = frame; stableSince = performance.now(); }
              if (performance.now() - stableSince >= 350) resolve();
              else if (performance.now() - started > 10000) reject(new Error('Map/panel geometry did not settle'));
              else requestAnimationFrame(check);
            }
            check();
          });
        });
        if (s.selectedIDs.length) {
          const points = activities.filter((a) => s.selectedIDs.includes(Number(a.id)))
            .flatMap((a) => polyline.decode(a.map_summary_polyline || a.map_polyline || '').map(([lat, lng]) => [lng, lat]));
          assert(points.length, `No route geometry for ${s.id}`);
          framing = await page.evaluate((coordinates) => {
            const map = window.__ACTIVITYMAP_GALLERY_MAP__;
            const rect = map.getContainer().getBoundingClientRect();
            const panel = document.querySelector('#map-route-panel').getBoundingClientRect();
            const projected = coordinates.map((coordinate) => map.project(coordinate));
            const contained = projected.every((p) => p.x >= 16 && p.x <= rect.width - 16 && p.y >= 16 && p.y <= rect.height - 16
              && !(p.x + rect.x > panel.left - 16 && p.x + rect.x < panel.right + 16 && p.y + rect.y > panel.top - 16 && p.y + rect.y < panel.bottom + 16));
            const padding = map.getPadding();
            const coverage = Math.max(
              (Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x))) / (rect.width - padding.left - padding.right),
              (Math.max(...projected.map(p => p.y)) - Math.min(...projected.map(p => p.y))) / (rect.height - padding.top - padding.bottom));
            return { contained, coverage, zoom: map.getZoom(), padding, map: rect.toJSON(), panel: panel.toJSON(), pointCount: projected.length };
          }, points);
          assert(framing.contained, `Route is clipped or covered in ${s.id}/${v.name}: ${JSON.stringify(framing)}`);
          assert(framing.coverage > 0.6 || framing.zoom >= 15.99, `Route was not fitted in ${s.id}/${v.name}: ${JSON.stringify(framing)}`);
        }
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
        framing,
      }, null, 2));
      console.log(`captured ${stem} (${Date.now() - started} ms)`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
