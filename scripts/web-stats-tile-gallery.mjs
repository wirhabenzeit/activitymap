// Capture actual dashboard elements, including their real expansion controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const [output, baseURL = 'http://localhost:3000'] = process.argv.slice(2);
assert(output, 'Pass an output directory');
const base = new URL(baseURL);
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'Use the local dev server');
const repo = resolve(import.meta.dirname, '..');
const library = process.env.ACTIVITYMAP_GALLERY_LIBRARY || join(repo, 'ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json');
const bytes = readFileSync(library);
const { activities } = JSON.parse(bytes);
const fixtureHash = createHash('sha256').update(bytes).digest('hex');
const today = process.env.ACTIVITYMAP_STATS_GALLERY_DAY || '2026-09-22';
const manifest = JSON.parse(readFileSync(join(repo, 'shared/stats-capabilities.v1.json')));
const tiles = manifest.tiles.filter((tile) => tile.visibility === 'visible');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  // Web shell + grid consume 72px; keep the actual card equal to the native
  // 378pt card, without overriding any production tile styles.
  const viewportWidth = 450;
  const context = await browser.newContext({ viewport: { width: viewportWidth, height: 874 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-CH',
    timezoneId: 'Europe/Zurich', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(({ activities }) => {
    window.__ACTIVITYMAP_GALLERY__ = { activities, selectedIDs: [] };
    localStorage.setItem('theme', 'light');
  }, { activities });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Freeze Date only; timers/animation frames keep running so charts can render.
  await page.clock.setFixedTime(new Date(`${today}T12:00:00+02:00`));
  const response = await page.goto(new URL('/stats/tiles', base).href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  assert(response?.ok(), `Navigation failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__ACTIVITYMAP_GALLERY_READY__ === true);
  await page.locator('[data-tile-id]').first().waitFor();
  assert.equal(await page.locator('[data-tile-id]').count(), tiles.length);
  await page.addStyleTag({ content: 'nextjs-portal, .tsqd-parent-container { display: none !important; }' });
  async function settle() {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }
  for (const tile of tiles) {
    const card = page.locator(`[data-tile-id="${tile.id}"]`);
    const title = await card.locator('h3').innerText();
    for (const state of tile.id === 'weeklyVolume' ? ['collapsed', 'expanded', 'expanded-months', 'expanded-years'] : tile.expandable ? ['collapsed', 'expanded'] : ['collapsed']) {
      if (state === 'expanded') {
        await card.getByRole('button', { name: `Expand ${title}`, exact: true }).click();
        await card.getByRole('button', { name: `Collapse ${title}`, exact: true }).waitFor();
      }
      if (state.startsWith('expanded-')) {
        await card.getByRole('combobox', { name: 'Volume grouping' }).click();
        await page.getByRole('option', { name: state === 'expanded-months' ? 'By month' : 'By year', exact: true }).click();
      }
      await settle();
      let bounds = await card.boundingBox();
      assert(bounds && bounds.width > 0 && bounds.height > 0);
      // Fit even tall history cards inside the scroller before element capture.
      await page.setViewportSize({ width: viewportWidth, height: Math.max(874, Math.ceil(bounds.height) + 240) });
      await card.scrollIntoViewIfNeeded();
      await settle();
      bounds = await card.boundingBox();
      assert(Math.abs(bounds.width - 378) < 1, `Unexpected tile width: ${bounds.width}`);
      const stem = `web-${tile.id}-${state}`;
      await card.screenshot({ path: join(output, `${stem}.png`), animations: 'disabled' });
      writeFileSync(join(output, `${stem}.json`), JSON.stringify({ platform: 'web', tile: tile.id,
        title, state, today, fixtureHash, activityCount: activities.length,
        width: bounds.width, height: bounds.height, viewportWidth, scale: 2, option: tile.defaultOption ?? 'none',
        capture: 'Element screenshot of production dashboard; expanded using its button' }, null, 2));
      console.log(`Captured ${stem}`);
    }
    if (tile.expandable) await card.getByRole('button', { name: `Collapse ${title}`, exact: true }).click();
    await page.setViewportSize({ width: viewportWidth, height: 874 });
  }
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
} finally { await browser.close(); }
