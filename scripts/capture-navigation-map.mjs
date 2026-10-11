// Verify the accepted map navigation contract against synthetic data and capture its controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3018');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Use a local server',
);
const output = resolve(process.argv[3] || '/tmp/activitymap-navigation-map');
const repo = resolve(import.meta.dirname, '..');
const route = join(repo, 'src/app/navigation-map-audit');
const bytes = await readFile(
  join(
    repo,
    'ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json',
  ),
);
// Exaggeration stays zero. A local PNG satisfies the renderer's DEM dependency;
// terrain accuracy and basemap appearance are outside this control audit.
const offlineTile = await readFile(
  join(repo, 'public/android-chrome-512x512.png'),
);
const fixture = JSON.parse(bytes);
const scenarios = JSON.parse(
  await readFile(join(repo, 'shared/gallery-scenarios.json')),
);
const selectedIDs = scenarios.scenarios.find(
  (item) => item.id === 'map-results',
).selectedIDs;
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim(),
  fixtureHash: createHash('sha256').update(bytes).digest('hex'),
  method:
    'Production InteractiveMap and shell controls on a temporary fixture route; offline map style',
  startedAt: new Date().toISOString(),
  observations: [],
};
await mkdir(output, { recursive: true });
await mkdir(route); // Refuse to overwrite an existing route.
let browser;
try {
  await writeFile(
    join(route, 'page.tsx'),
    `
'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppSidebar } from '~/components/layout/app-sidebar';
import { AppHeader } from '~/components/layout/app-header';
import { SidebarProvider } from '~/components/ui/sidebar';
import { prepareGallery } from '~/lib/gallery-fixture';
import { store } from '~/store';
const Map = dynamic(() => import('~/components/map/interactive-map'), { ssr: false });
export default function Review() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } }));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    prepareGallery(client);
    (window as any).__NAVIGATION_AUDIT_STATE__ = () => {
      const state = store.getState();
      return { selected: state.selected, active: state.highlighted, camera: state.position,
        notifications: state.notifications.map(({ type, title, message }) => ({ type, title, message })) };
    };
    setReady(true);
  }, [client]);
  if (!ready) return null;
  return <QueryClientProvider client={client}><SidebarProvider className="flex h-dvh flex-col"><AppHeader /><div className="flex min-h-0 flex-1 overflow-hidden"><AppSidebar /><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><div className="h-14 w-full shrink-0"/><div className="min-h-0 w-full flex-1 overflow-hidden"><Map /></div></main></div></SidebarProvider></QueryClientProvider>;
}
`,
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  report.browser = browser.version();
  for (const [width, height] of [
    [1440, 1000],
    [874, 402],
    [402, 874],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      locale: 'en-US',
      timezoneId: 'Europe/Zurich',
    });
    const observation = { width, height, errors: [], mapErrors: [], steps: [] };
    report.observations.push(observation);
    try {
      // Render synthetic routes without a token, tile requests or a live basemap.
      await context.route('https://api.mapbox.com/**', async (request) => {
        if (request.request().url().includes('/styles/v1/')) {
          await request.fulfill({
            json: {
              version: 8,
              sources: {},
              layers: [
                {
                  id: 'background',
                  type: 'background',
                  paint: { 'background-color': '#e5e8df' },
                },
              ],
            },
          });
        } else if (
          request.request().url().includes('/v4/') &&
          request.request().url().includes('.json')
        ) {
          await request.fulfill({
            json: {
              tilejson: '2.2.0',
              tiles: [
                'https://api.mapbox.com/navigation-audit-dem/{z}/{x}/{y}.png',
              ],
              minzoom: 0,
              maxzoom: 14,
            },
          });
        } else if (request.request().url().includes('/navigation-audit-dem/')) {
          await request.fulfill({
            contentType: 'image/png',
            body: offlineTile,
          });
        } else await request.fulfill({ status: 200, body: '{}' });
      });
      await context.route('https://events.mapbox.com/**', (request) =>
        request.fulfill({ status: 200, body: '{}' }),
      );
      await context.addInitScript(
        ({ activities, selectedIDs }) => {
          window.__ACTIVITYMAP_GALLERY__ = { activities, selectedIDs };
          localStorage.setItem('theme', 'light');
          localStorage.setItem(
            'activitymap-ui-state',
            JSON.stringify({
              version: 1,
              state: {
                position: {
                  longitude: 9.1,
                  latitude: 46.95,
                  zoom: 6.5,
                  bearing: 0,
                  pitch: 0,
                },
              },
            }),
          );
        },
        { activities: fixture.activities, selectedIDs },
      );
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', (error) => {
        observation.errors.push(error.stack || error.message);
        console.error(error.stack || error.message);
      });
      const response = await page.goto(
        new URL('/navigation-map-audit', base).href,
        { timeout: 120000 },
      );
      assert(response?.ok(), `Navigation failed: ${response?.status()}`);
      await page.waitForFunction(() =>
        window.__ACTIVITYMAP_GALLERY_MAP__?.loaded(),
      );
      await page.evaluate(() =>
        window.__ACTIVITYMAP_GALLERY_MAP__.on('error', (event) => {
          (window.__NAVIGATION_AUDIT_MAP_ERRORS__ ??= []).push(
            event.error?.message,
          );
        }),
      );
      await page.addStyleTag({
        content:
          'nextjs-portal, .tsqd-parent-container { display:none !important; }',
      });
      const observe = async (name) => {
        await page.waitForFunction(
          () => !window.__ACTIVITYMAP_GALLERY_MAP__.isMoving(),
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          );
        });
        const snapshot = await page.evaluate(() => {
          const panel = document.querySelector('#map-route-panel');
          const map = window.__ACTIVITYMAP_GALLERY_MAP__;
          return {
            url: location.pathname + location.search + location.hash,
            historyLength: history.length,
            state: window.__NAVIGATION_AUDIT_STATE__(),
            camera: {
              center: map.getCenter(),
              zoom: map.getZoom(),
              bearing: map.getBearing(),
              pitch: map.getPitch(),
              padding: map.getPadding(),
            },
            panel: panel?.getBoundingClientRect().toJSON(),
            detailOpen: Boolean(
              document.querySelector('[data-detail-presentation]'),
            ),
            filtersExpanded: document
              .querySelector('[data-sidebar="sidebar"]')
              ?.closest('[data-state]')
              ?.getAttribute('data-state'),
            controls: [
              ...document.querySelectorAll('#map-route-panel button'),
            ].map((button) => ({
              label: button.getAttribute('aria-label'),
              title: button.title,
              text: button.textContent,
            })),
          };
        });
        observation.steps.push({ name, ...snapshot });
        await page.screenshot({
          path: join(output, `map-${name}--${width}x${height}.png`),
          animations: 'disabled',
        });
      };
      await observe('four-selected');
      await page
        .getByRole('button', { name: 'Fit selection', exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector('[data-route-fit="pending"]'),
      );
      await observe('fit-selection');
      await page.locator('#map-route-panel [data-activity-id]').first().click();
      await page.locator('[data-detail-presentation]').waitFor();
      await observe('inspect-one');
      await page
        .getByRole('button', { name: 'Fit route', exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector('[data-route-fit="pending"]'),
      );
      await observe('fit-route');
      await page
        .getByRole('button', { name: 'Expand route panel', exact: true })
        .click();
      await observe('expand-panel');
      await page
        .getByRole('button', { name: 'Shrink route panel', exact: true })
        .click();
      await observe('shrink-panel');
      await page.keyboard.press('Escape');
      await page
        .locator('[data-detail-presentation]')
        .waitFor({ state: 'hidden' });
      await observe('back-to-four');
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await observe('filters-toggled');
      await page.keyboard.press('Escape');
      await observe('filters-after-escape');
      if (width >= 480)
        await page
          .getByRole('button', { name: 'Filters', exact: true })
          .click();
      await page.locator('#map-route-panel [data-activity-id]').first().click();
      await page.locator('[data-detail-presentation]').waitFor();
      await observe('inspect-before-clear');
      await page
        .getByRole('button', { name: 'Selection actions', exact: true })
        .click();
      await page.getByRole('menu').waitFor();
      await page.screenshot({ path: join(output, `map-selection-actions--${width}x${height}.png`), animations: 'disabled' });

      await page
        .getByRole('menuitem', { name: 'Clear selection', exact: true })
        .click();
      await page.waitForFunction(
        () => window.__NAVIGATION_AUDIT_STATE__().selected.length === 0,
      );
      await observe('clear-selection');
      const steps = Object.fromEntries(
        observation.steps.map((step) => [step.name, step]),
      );
      const initial = steps['four-selected'],
        detail = steps['inspect-one'],
        fitted = steps['fit-route'],
        back = steps['back-to-four'],
        cleared = steps['clear-selection'];
      assert.equal(initial.state.selected.length, 4);
      for (const step of observation.steps.filter((step) => step !== cleared))
        assert.deepEqual(step.state.selected, initial.state.selected);
      assert.equal(back.state.active, detail.state.active);
      assert.equal(fitted.state.active, detail.state.active);
      assert.equal(fitted.detailOpen, true);
      for (const name of [
        'expand-panel',
        'shrink-panel',
        'back-to-four',
        'clear-selection',
      ])
        assert.deepEqual(steps[name].camera, fitted.camera);
      assert.equal(cleared.state.selected.length, 0);
      assert.equal(cleared.state.active, 0);
      assert.equal(cleared.detailOpen, false);
      if (width < 480)
        assert.equal(
          steps['filters-after-escape'].filtersExpanded,
          'collapsed',
        );
      for (const step of observation.steps)
        assert.equal(step.historyLength, initial.historyLength);
      assert.deepEqual(observation.errors, []);
      assert.notEqual(steps['fit-selection'].camera.zoom, initial.camera.zoom);
      assert.deepEqual(fitted.state.notifications, []);
      observation.mapErrors = await page.evaluate(
        () => window.__NAVIGATION_AUDIT_MAP_ERRORS__ ?? [],
      );
      console.log(`Captured map controls at ${width}x${height}`);
    } finally {
      await context.close();
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(
    join(output, 'observations.json'),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  await rm(route, { recursive: true, force: true });
  await rm(
    resolve(import.meta.dirname, '../.next/dev/types/app/navigation-map-audit'),
    { recursive: true, force: true },
  );
}
