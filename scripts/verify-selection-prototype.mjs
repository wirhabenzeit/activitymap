// Development-only fixture route, using the real map, table and detail cards.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
const base = new URL(process.argv[2] || 'http://127.0.0.1:3020');
assert(['127.0.0.1', 'localhost'].includes(base.hostname));
const output = resolve(
  process.argv[3] || '/tmp/activitymap-selection-prototype',
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'en-US',
  timezoneId: 'Europe/Zurich',
  reducedMotion: 'reduce',
});
await context.addInitScript(() => {
  localStorage.setItem('theme', 'light');
  localStorage.removeItem('activitymap-ui-state');
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const rows = () => page.locator('#table-main tbody tr[data-activity-id]');
const count = async (n) => {
  await page.waitForFunction(
    (n) =>
      document
        .querySelector('[data-selection-bar]')
        ?.textContent.includes(`${n} selected`),
    n,
  );
};
const mode = () => page.getByRole('button', { name: 'Combine selections' });
const navigate = async (name) => {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(250);
};
const scope = async (wanted, root = page) => {
  const control = root.getByRole('switch', {
    name: 'Only selected activities',
  });
  const popover = !(await control.isVisible());
  if (popover)
    await root
      .getByRole('button', { name: 'Selected activities filter', exact: true })
      .click();
  if (((await control.getAttribute('aria-checked')) === 'true') !== wanted)
    await control.click();
  if (popover) {
    await page.keyboard.press('Escape');
    await control.waitFor({ state: 'hidden' });
  }
};
const reset = async () => {
  await page.getByRole('button', { name: 'Reset prototype' }).click();
  await count(5);
};
try {
  assert(
    (
      await page.goto(new URL('/selection-prototype', base).href, {
        timeout: 120000,
      })
    )?.ok(),
  );
  await count(5);
  await page.waitForFunction(
    () =>
      window.__ACTIVITYMAP_GALLERY_MAP__?.isStyleLoaded() &&
      document.querySelector('[data-route-fit="idle"]'),
  );
  await page.addStyleTag({
    content: 'nextjs-portal {display:none !important}',
  });
  const panel = page.locator('#map-route-panel');
  assert.equal(
    await panel
      .getByRole('button', { name: 'Fit selection', exact: true })
      .count(),
    1,
  );
  await panel.locator('tbody tr[data-activity-id]').first().click();
  await panel.getByRole('button', { name: 'Fit route', exact: true }).waitFor();
  assert.equal(
    await panel.getByRole('button', { name: 'Fit route', exact: true }).count(),
    1,
  );
  assert.equal(
    await panel
      .getByRole('button', { name: 'Fit selection', exact: true })
      .count(),
    0,
  );
  await panel.getByRole('button', { name: 'Fit route', exact: true }).click();
  await page.waitForSelector('[data-route-fit="idle"]');
  await count(5);
  await panel.getByRole('button', { name: /Back to 5 routes/ }).click();
  await panel
    .getByRole('button', { name: 'Fit selection', exact: true })
    .waitFor();
  assert.equal(
    await panel.getByRole('button', { name: 'Fit route', exact: true }).count(),
    0,
  );
  await page.screenshot({ path: resolve(output, 'map-mobile.png') });
  // The view scope hides unselected routes and follows the same group into List.
  await scope(true);
  await page.waitForFunction(
    () =>
      window.__ACTIVITYMAP_GALLERY_MAP__?.queryRenderedFeatures({
        layers: ['routeLayerBG'],
      }).length === 0,
  );
  await navigate('List');
  await page.waitForSelector('[data-list-inspection-ready="true"]');
  assert.equal(await rows().count(), 5);
  assert.equal(await rows().locator('[data-selection-checkmark]').count(), 0);
  assert.equal(
    await rows()
      .filter({ has: page.locator('.text-header-background') })
      .count(),
    5,
  );
  const footer = await page.locator('[data-selection-footer]').boundingBox();
  assert(footer.y > 700, 'List controls live in the footer');
  await rows().first().getByText('Lunch Ride', { exact: true }).click();
  await page.waitForSelector('[data-detail-presentation="push"]');
  await count(5);
  assert(await mode().isVisible(), 'Footer mode remains reachable in detail');
  await page
    .getByRole('button', { name: 'Back to activities', exact: true })
    .click();
  await scope(false);
  await scope(true);
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await count(5);
  assert.equal(await rows().count(), 20);
  assert.equal(
    await rows()
      .getByRole('button', { name: /^(Select|Deselect) / })
      .count(),
    0,
  );
  await page.getByRole('button', { name: 'View', exact: true }).click();
  assert.equal(
    await page
      .getByRole('menuitem', {
        name: 'Select all filtered activities',
        exact: true,
      })
      .count(),
    0,
  );
  await page.keyboard.press('Escape');
  // In ordinary mode rows inspect. Show on map still replaces the group.
  await rows()
    .getByRole('button', { name: 'Show Morning Walk on map', exact: true })
    .click();
  await count(1);
  await page.waitForURL((url) => url.searchParams.get('view') === 'map');
  await reset();
  await navigate('List');
  await mode().click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page
    .getByRole('menuitem', {
      name: 'Select all filtered activities',
      exact: true,
    })
    .click();
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await count(20);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page
    .getByRole('menuitem', {
      name: 'Deselect all filtered activities',
      exact: true,
    })
    .click();
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await count(0);
  assert.equal(await mode().getAttribute('aria-pressed'), 'true');
  await reset();
  await mode().click();
  assert.equal(await rows().locator('[data-selection-checkmark]').count(), 5);
  await page.screenshot({ path: resolve(output, 'list-combine-mobile.png') });
  await rows()
    .getByRole('button', { name: 'Select Morning Walk', exact: true })
    .click();
  await count(6);
  await rows()
    .getByRole('button', { name: 'Deselect Lunch Ride', exact: true })
    .click();
  await count(5);
  await mode().click();
  await count(5);
  assert.equal(await rows().locator('[data-selection-checkmark]').count(), 0);
  await reset();
  await page.screenshot({ path: resolve(output, 'list-mobile.png') });
  await mode().click();
  await scope(true);
  await rows()
    .getByRole('button', { name: 'Deselect Lunch Ride', exact: true })
    .click();
  await count(4);
  assert.equal(await rows().count(), 4);
  await navigate('Map');
  assert.equal(await mode().getAttribute('aria-pressed'), 'true');
  assert(
    await page
      .locator(
        '[data-selection-bar] [aria-label="Showing selected activities only"]',
      )
      .isVisible(),
  );
  await page.screenshot({ path: resolve(output, 'map-combine-mobile.png') });
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  assert.equal(await mode().getAttribute('aria-pressed'), 'true');
  assert(await mode().isVisible());
  assert.equal(await rows().count(), 0);
  await page
    .getByRole('button', { name: 'Selected activities filter', exact: true })
    .click();
  const emptyScope = page.getByRole('switch', {
    name: 'Only selected activities',
  });
  assert(await emptyScope.isDisabled());
  assert.equal(await emptyScope.getAttribute('aria-checked'), 'false');
  await page.keyboard.press('Escape');
  await reset();
  await page.waitForFunction(
    () =>
      window.__ACTIVITYMAP_GALLERY_MAP__?.isStyleLoaded() &&
      document.querySelector('[data-route-fit="idle"]'),
  );
  // Hit an actual overlap through the Mapbox canvas, exercising the picking control.
  await page.evaluate(() =>
    window.__ACTIVITYMAP_GALLERY_MAP__.jumpTo({
      center: [8.535, 47.356],
      zoom: 14,
    }),
  );
  await page.waitForTimeout(500);
  const hit = await page.evaluate(() => {
    const map = window.__ACTIVITYMAP_GALLERY_MAP__;
    const panel = document
      .querySelector('#map-route-panel')
      .getBoundingClientRect();
    const rect = map.getCanvas().getBoundingClientRect();
    const features = map.queryRenderedFeatures({
      layers: ['routeLayerBG', 'routeLayerBGsel'],
    });
    let best;
    for (const feature of features)
      for (const coord of feature.geometry.type === 'LineString'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat()) {
        const p = map.project(coord);
        const x = p.x + rect.x,
          y = p.y + rect.y;
        if (
          x < rect.left + 55 ||
          x > rect.right - 50 ||
          y < rect.top + 70 ||
          y > panel.top - 15
        )
          continue;
        const ids = [
          ...new Set(
            map
              .queryRenderedFeatures(
                [
                  [p.x - 5, p.y - 5],
                  [p.x + 5, p.y + 5],
                ],
                { layers: ['routeLayerBG', 'routeLayerBGsel'] },
              )
              .map((f) => f.id),
          ),
        ];
        if (!best || ids.length > best.ids.length) best = { x, y, ids };
      }
    return best;
  });
  assert(
    hit?.ids.length > 1,
    `An overlapping route hit is available: ${JSON.stringify(hit)}`,
  );
  await page.mouse.click(hit.x, hit.y);
  await count(hit.ids.length);
  await navigate('List');
  assert.equal(
    await page.locator('#table-main tr[data-state="selected"]').count(),
    hit.ids.length,
  );
  await reset();
  // Show on map respects exclusive selection and keeps the prototype destination.
  await rows()
    .getByRole('button', { name: 'Show Morning Walk on map', exact: true })
    .click();
  await count(1);
  await page.waitForURL((url) => url.searchParams.get('view') === 'map');
  await reset();
  for (const [width, height] of [
    [320, 720],
    [844, 390],
    [1440, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    assert(await mode().isVisible());
    assert(
      await page
        .getByRole('button', {
          name: 'Selected activities filter',
          exact: true,
        })
        .isVisible(),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: resolve(output, `map-${width}.png`) });
  }
  // The embedded phone preview is the same functional application.
  await page.goto(new URL('/selection-prototype?device=phone', base).href);
  const phone = page.frameLocator('iframe');
  await phone.locator('[data-selection-bar]').waitFor();
  await scope(true, phone);
  await phone.getByRole('button', { name: 'List', exact: true }).click();
  await phone.locator('[data-list-inspection-ready="true"]').waitFor();
  assert.equal(
    await phone.locator('#table-main tbody tr[data-activity-id]').count(),
    5,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Verified Filters scope, compact Map header, persistent List footer, sport-icon checkmarks only in Combine, group preservation, overlap picking, Show on map, clear, responsive layouts and embedded preview.',
  );
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
