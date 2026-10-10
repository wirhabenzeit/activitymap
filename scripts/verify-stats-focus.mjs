// Real shell, charts, URL/history and adaptive activity inspection against local DTOs.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Use a local dev server',
);
const output = resolve(process.argv[3] || '/tmp/activitymap-stats-focus');
const route = resolve(import.meta.dirname, '../src/app/stats-focus-test');
await mkdir(route); // Refuse to replace an existing route.
await mkdir(output, { recursive: true });
let browser;
try {
  await writeFile(
    join(route, 'page.tsx'),
    `
'use client';
import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatsTileGrid } from '~/components/stats/tiles';
import { StatsActivityInspector } from '~/components/stats/tiles/activity-inspector';
import { AppSidebar } from '~/components/layout/app-sidebar';
import { AppHeader } from '~/components/layout/app-header';
import { SidebarProvider } from '~/components/ui/sidebar';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { toStatsActivity } from '~/lib/stats/tile-series';
import { dayFromISODate } from '~/lib/stats/tile-data';
import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
const defaults = Object.fromEntries(Object.keys(activityDTOSchema.shape).filter(key => key !== 'streams').map(key => [key, null]));
function FixtureStats() {
  const activities = useMemo(() => fixture.activities.map(item => dtoToActivity(activityDTOSchema.parse({...defaults, ...item}))), []);
  const stats = useMemo(() => activities.map(toStatsActivity), [activities]);
  return <StatsActivityInspector activities={activities}>{(open, detailsOpen, inspection) => <StatsTileGrid {...inspection} activities={stats} reportingDay={dayFromISODate('2026-09-22')} onOpenActivity={open} detailsOpen={detailsOpen} />}</StatsActivityInspector>;
}
export default function Review() {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><SidebarProvider className="flex h-dvh flex-col"><AppHeader /><div className="flex min-h-0 flex-1 overflow-hidden"><AppSidebar /><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><div className="h-14 w-full shrink-0"/><div className="min-h-0 w-full flex-1 overflow-hidden"><FixtureStats /></div></main></div></SidebarProvider></QueryClientProvider>;
}
`,
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    locale: 'en-US',
  });
  await context.addInitScript(() => {
    localStorage.setItem('theme', 'light');
    // Count native transitions; reduced-motion runs should never invoke one.
    window.__statsTransitions = 0;
    window.__statsTransitionGeometry = [];
    const start = document.startViewTransition?.bind(document);
    if (start)
      document.startViewTransition = (update) => {
        window.__statsTransitions++;
        const source = document
          .querySelector('[data-stats-transition-tile]')
          ?.getBoundingClientRect()
          .toJSON();
        return start(async () => {
          await update();
          const target = document.querySelector('[data-stats-transition-tile]');
          window.__statsTransitionGeometry.push({
            source,
            target: target?.getBoundingClientRect().toJSON(),
            charts: target?.querySelectorAll('svg').length ?? 0,
          });
        });
      };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const path = '/stats-focus-test';
  const dashboard = page.locator('[data-stats-dashboard]');
  const focus = page.locator('[data-stats-focus]:visible');
  const card = (id) => page.locator(`[data-tile-id="${id}"]`);
  const active = async (id) => {
    await page.waitForFunction(
      (id) => new URL(location.href).searchParams.get('tile') === id,
      id,
    );
    if (id) await focus.waitFor();
    else await dashboard.waitFor({ state: 'visible' });
  };
  const settle = async () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
  const loaded = async (query = '') => {
    const response = await page.goto(new URL(path + query, base).href, {
      timeout: 120000,
    });
    assert(response?.ok(), `Navigation failed: ${response?.status()}`);
    await card('weeklyVolume').waitFor({
      state: query ? 'attached' : 'visible',
    });
    await page.addStyleTag({
      content:
        'nextjs-portal, .tsqd-parent-container { display:none !important; }',
    });
    await settle();
  };
  const tiles = [
    ['weeklyVolume', 'training-volume'],
    ['monthVsLastMonth', 'this-month'],
    ['yearToDate', 'year-to-date'],
    ['records', 'records'],
    ['activityCalendar', 'activity-calendar'],
    ['sportMix', 'sport-mix'],
    ['distanceVsElevation', 'hilliness'],
  ];
  for (const [width, height] of [
    [1440, 1000],
    [874, 402],
    [402, 874],
  ]) {
    await page.setViewportSize({ width, height });
    await loaded();
    for (const [id, slug] of tiles) {
      if (id === 'sportMix' && width === 1440) {
        assert.equal(
          await card(id)
            .getByRole('button', { name: /^Expand / })
            .count(),
          0,
        );
        assert.equal(
          await card(id)
            .getByRole('table', { name: 'Sport breakdown' })
            .count(),
          1,
        );
        continue;
      }
      const expand = card(id).getByRole('button', { name: /^Expand / });
      await expand.scrollIntoViewIfNeeded();
      const scroll = await dashboard.evaluate((element) => element.scrollTop);
      const geometry = await dashboard
        .locator('[data-tile-id]')
        .evaluateAll((elements) =>
          elements.map((element) => [
            element.dataset.tileId,
            element.offsetTop,
            element.offsetWidth,
            element.offsetHeight,
          ]),
        );
      const historyIndex = await page.evaluate(
        () => window.navigation.currentEntry.index,
      );
      await expand.click();
      await active(slug);
      assert.equal(
        await page.evaluate(() => window.navigation.currentEntry.index),
        historyIndex + 1,
      );
      assert(
        await page.evaluate(
          () => !!window.history.state.statsTileFocus?.dashboardURL,
        ),
      );
      assert.equal(await dashboard.getAttribute('inert'), '');
      assert.equal(
        await focus
          .getByRole('button', { name: 'Back to stats dashboard' })
          .evaluate((button) => button === document.activeElement),
        true,
      );
      await page.keyboard.press('Tab');
      assert.equal(
        await focus.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        true,
        `${slug}: keyboard order`,
      );
      const bounds = await focus.boundingBox();
      assert(bounds && bounds.width > 0 && bounds.height > 0);
      assert.equal(
        await focus.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
        false,
        `${slug} overflows horizontally`,
      );
      await settle();
      await page.screenshot({
        path: join(output, `${slug}--${width}x${height}.png`),
        animations: 'disabled',
      });
      const method = tiles.findIndex(([tile]) => tile === id) % 3;
      if (method === 0)
        await focus
          .getByRole('button', { name: 'Back to stats dashboard' })
          .click();
      else if (method === 1) await page.keyboard.press('Escape');
      else await page.goBack();
      await active(null);
      assert.equal(
        await dashboard.evaluate((element) => element.scrollTop),
        scroll,
        `${slug}: scroll return`,
      );
      assert.deepEqual(
        await dashboard
          .locator('[data-tile-id]')
          .evaluateAll((elements) =>
            elements.map((element) => [
              element.dataset.tileId,
              element.offsetTop,
              element.offsetWidth,
              element.offsetHeight,
            ]),
          ),
        geometry,
        `${slug}: dashboard reflow`,
      );
      assert.equal(
        await expand.evaluate((button) => button === document.activeElement),
        true,
        `${slug}: focus return`,
      );
    }
    console.log(
      `Available focus controls and return paths pass at ${width}×${height}`,
    );
  }
  assert.equal(
    await page.evaluate(() => window.__statsTransitions),
    0,
    'Reduce Motion must skip zoom',
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await loaded('?keep=1#anchor');
  await card('weeklyVolume')
    .getByRole('button', { name: 'Moving time', exact: true })
    .click();
  await card('weeklyVolume')
    .getByRole('button', { name: 'Expand Training volume' })
    .click();
  await active('training-volume');
  assert.equal(new URL(page.url()).searchParams.get('keep'), '1');
  assert.equal(new URL(page.url()).hash, '#anchor');
  await focus.getByRole('combobox', { name: 'Volume grouping' }).click();
  await page.getByRole('option', { name: 'By month', exact: true }).click();
  assert.equal(
    await focus.locator('details').count(),
    0,
    'Wide period totals should be open',
  );
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await active(null);
  assert.equal(
    await card('weeklyVolume')
      .getByRole('button', { name: 'Moving time', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.goForward();
  await active('training-volume');
  assert.match(
    await focus.getByRole('combobox', { name: 'Volume grouping' }).innerText(),
    /By month/,
  );
  await page.setViewportSize({ width: 402, height: 874 });
  assert.match(
    await focus.getByRole('combobox', { name: 'Volume grouping' }).innerText(),
    /By month/,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await active(null);
  await card('weeklyVolume')
    .getByRole('button', { name: 'Expand Training volume' })
    .click();
  await active('training-volume');
  assert.match(
    await focus.getByRole('combobox', { name: 'Volume grouping' }).innerText(),
    /By month/,
  );
  await page.reload();
  await active('training-volume');
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await active(null);
  console.log('Metric/grouping, Forward, resize and focus URL reload pass');

  await loaded('?tile=records');
  await active('records');
  assert.equal(
    await focus.getByRole('region', { name: 'This year records' }).count(),
    1,
  );
  assert.equal(
    await focus.getByRole('region', { name: 'All time records' }).count(),
    1,
  );
  await focus
    .getByRole('button')
    .filter({ hasText: /Morning|Ride|Run|Hike|Walk|ride|run|hike|walk/ })
    .first()
    .click();
  const dialog = page.getByRole('region', { name: 'Activity detail panel' });
  await dialog.waitFor();
  const activityURL = page.url();
  assert.ok(new URL(activityURL).searchParams.get('activity'));
  await page.goBack();
  await dialog.waitFor({ state: 'hidden' });
  await active('records');
  assert.equal(new URL(page.url()).searchParams.has('activity'), false);
  await page.goForward();
  await dialog.waitFor();
  assert.equal(page.url(), activityURL);
  assert.equal(
    await focus.getByRole('region', { name: 'This year records' }).count(),
    1,
  );
  assert.equal(
    await focus.getByRole('region', { name: 'All time records' }).count(),
    1,
  );
  assert.equal(
    await focus.getByRole('group', { name: 'Records period' }).count(),
    0,
  );
  assert.ok(
    await focus
      .locator('[data-stats-activity-id][aria-current="true"]')
      .count(),
  );
  assert.equal(
    await focus.isVisible(),
    true,
    'Chart stays available beside panel',
  );
  // Focus Back closes a pushed inspection first, even on a direct focus link.
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await active('records');
  await page.goForward();
  await dialog.waitFor();
  assert.equal(page.url(), activityURL);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[data-stats-focus] [data-stats-activity-id][aria-current="true"]',
      ),
  );
  assert.equal(
    await focus
      .locator('[data-stats-activity-id][aria-current="true"]')
      .count(),
    0,
  );
  await active('records');
  await focus
    .getByRole('region', { name: 'All time records' })
    .getByRole('button')
    .first()
    .click();
  await dialog.waitFor();
  await page.setViewportSize({ width: 402, height: 874 });
  const pushedDetail = page.getByRole('region', {
    name: 'Activity detail view',
  });
  await pushedDetail.waitFor();
  await pushedDetail
    .getByRole('button', { name: 'Back to stats', exact: true })
    .click();
  await pushedDetail.waitFor({ state: 'hidden' });
  assert.equal(
    await focus
      .getByRole('group', { name: 'Records period' })
      .getByRole('button', { name: 'All time', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.waitForFunction(() =>
    document.activeElement?.hasAttribute('data-stats-activity-id'),
  );
  await page.keyboard.press('Escape');
  await active(null);
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('Nested activity Escape and direct-link Back pass');

  // A direct activity link never pushed a chart entry. Replacing its activity
  // must not turn Close/Escape into browser Back to an unrelated page.
  for (const dismiss of ['close', 'escape']) {
    await loaded();
    await loaded(new URL(activityURL).search);
    await dialog.waitFor();
    const initialID = new URL(activityURL).searchParams.get('activity');
    await focus
      .locator(
        `[data-stats-activity-id]:not([data-stats-activity-id="${initialID}"])`,
      )
      .first()
      .click();
    await page.waitForFunction(
      (id) => new URL(location.href).searchParams.get('activity') !== id,
      initialID,
    );
    if (dismiss === 'close')
      await dialog
        .getByRole('button', { name: 'Close activity detail', exact: true })
        .click();
    else await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await active('records');
    assert.equal(new URL(page.url()).searchParams.has('activity'), false);
  }
  console.log('Direct-link activity replacement closes locally');

  await page.setViewportSize({ width: 402, height: 874 });
  await loaded('?tile=sport-mix');
  const extras = focus.locator('details');
  await extras.waitFor();
  assert.equal(await extras.getAttribute('open'), null);
  assert.equal(await extras.locator('dl').isVisible(), false);
  await extras.locator('summary').click();
  assert.equal(await extras.locator('dl').isVisible(), true);
  assert.match(await extras.innerText(), /climbed/);
  await page.screenshot({
    path: join(output, 'sport-mix-phone-expanded.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await loaded('?tile=this-week');
  assert.equal(
    await focus.count(),
    0,
    'Non-expandable names cannot open a focus view',
  );
  await loaded();
  // Opening a compact calendar day should carry that day into focus.
  await card('activityCalendar')
    .getByRole('button', { name: /2026: Ride/ })
    .first()
    .click();
  await active('activity-calendar');
  await focus
    .getByRole('region', { name: 'Selected day activities' })
    .waitFor();
  await settle();
  await page.screenshot({
    path: join(output, 'calendar-selected-day--1440x1000.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await active(null);
  console.log('Compact calendar day selection carries into focus');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loaded();
  await card('weeklyVolume')
    .getByRole('button', { name: 'Expand Training volume' })
    .click();
  await active('training-volume');
  await page.waitForFunction(
    () => !document.documentElement.hasAttribute('data-stats-transition'),
  );
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await active(null);
  await page.waitForFunction(
    () => !document.documentElement.hasAttribute('data-stats-transition'),
  );
  assert(
    (await page.evaluate(() => window.__statsTransitions)) >= 2,
    'Native zoom should run both ways',
  );
  const geometry = await page.evaluate(() => window.__statsTransitionGeometry);
  assert.equal(geometry.length, 2);
  assert(
    geometry[0].target.width > geometry[0].source.width,
    'Zoom grows from the originating tile',
  );
  assert(
    geometry[1].target.width < geometry[1].source.width,
    'Back zoom returns to the tile',
  );
  assert(
    geometry[0].charts >= 2,
    'Destination snapshot includes the chart, not only its header icon',
  );
  await page.evaluate(() => {
    document.startViewTransition = undefined;
  });
  await card('weeklyVolume')
    .getByRole('button', { name: 'Expand Training volume' })
    .click();
  await active('training-volume');
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await active(null);
  console.log('Native transition and unsupported-browser fallback pass');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'theme', newValue: 'dark' }),
    );
  });
  for (const [id, slug] of tiles) {
    if (id === 'sportMix') await loaded('?tile=sport-mix');
    else
      await card(id)
        .getByRole('button', { name: /^Expand / })
        .click();
    await active(slug);
    await settle();
    await page.screenshot({
      path: join(output, `${slug}--1440x1000-dark.png`),
      animations: 'disabled',
    });
    await focus
      .getByRole('button', { name: 'Back to stats dashboard' })
      .click();
    await active(null);
  }
  console.log('All seven dark focus surfaces captured');
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  await writeFile(
    join(output, 'verification.json'),
    JSON.stringify(
      {
        tiles,
        viewports: [
          [1440, 1000],
          [874, 402],
          [402, 874],
        ],
        errors,
        transitionGeometry: geometry,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await rm(route, { recursive: true, force: true });
  await rm(
    resolve(import.meta.dirname, '../.next/dev/types/app/stats-focus-test'),
    { recursive: true, force: true },
  );
}
