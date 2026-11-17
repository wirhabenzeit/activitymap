// Linked expanded views against the existing local, sample-data Stats route.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  launchBrowser,
  recordBrowserEvidence,
} from './quality/browser-support.mjs';

const base = new URL(process.argv[2] ?? 'http://localhost:3000');
assert(['localhost', '127.0.0.1'].includes(base.hostname));
const output = resolve(process.argv[3] ?? '/tmp/activitymap-stats-explorers');
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
  serviceWorkers: 'block',
});
const evidence = await recordBrowserEvidence(context, { base, output });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const focus = page.locator('[data-stats-focus]:visible');
const load = async (tile) => {
  await page.goto(new URL(`/stats-focus-preview?tile=${tile}`, base).href);
  await focus.waitFor();
  await page.evaluate(() => document.fonts.ready);
};
try {
  for (const width of [1440, 1024, 402]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tile of [
      'this-month',
      'training-volume',
      'year-to-date',
      'hilliness',
    ]) {
      await load(tile);
      await focus.locator('[data-explorer-chart]').waitFor();
      assert.equal(
        await focus.evaluate((e) => e.scrollWidth > e.clientWidth),
        false,
        `${tile} fits ${width}`,
      );
      assert.equal(
        await focus.locator('[data-explorer-period][tabindex="0"]').count(),
        1,
      );
      const selected = focus.locator(
        '[data-explorer-period][aria-pressed="true"]',
      );
      const key = await selected.getAttribute('data-explorer-period');
      await selected.focus();
      await page.keyboard.press('ArrowLeft');
      assert.equal(
        await selected.getAttribute('data-explorer-period'),
        key,
        'Arrow navigation does not change selection',
      );
      await page.keyboard.press('Enter');
      assert.notEqual(
        await focus
          .locator('[data-explorer-period][aria-pressed="true"]')
          .getAttribute('data-explorer-period'),
        key,
      );
      await page.screenshot({
        path: join(output, `${tile}-${width}.png`),
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load('this-month');
  assert.equal(
    await focus.getByRole('heading', { level: 1 }).innerText(),
    'September 2026',
  );
  assert.match(await focus.innerText(), /137 km ahead of August at this point/);
  assert.doesNotMatch(await focus.innerText(), /746%/);
  const metricChoices = focus.getByRole('group', {
    name: 'This month: Metric',
  });
  for (const [accessible, visible] of [
    ['Distance', 'Distance'],
    ['Moving time', 'Time'],
    ['Elevation', 'Elevation'],
    ['Activities', 'Activities'],
  ]) {
    assert.equal(
      (
        await metricChoices
          .getByRole('button', { name: accessible, exact: true })
          .innerText()
      ).trim(),
      visible,
    );
  }
  assert.match(
    await focus.locator('[data-explorer-chart]').innerText(),
    /As of Sep 22/,
  );

  assert.equal(
    await page.locator('#activity-filters').count(),
    1,
    'Existing Stats sidebar is retained',
  );
  assert(
    (await focus.locator('[data-explorer-chart]').boundingBox()).y + 32 < 280,
    'Cumulative plot begins near the summary',
  );
  assert.equal(await focus.locator('[data-current-endpoint]').count(), 1);
  assert.equal(await focus.locator('[data-future-region]').count(), 1);
  assert.equal(await focus.locator('[data-future-strip]').count(), 0);
  assert.equal(
    await focus.locator('[data-selected-day-highlight]').getAttribute('stroke'),
    'none',
  );
  assert.equal(await focus.locator('[data-selected-date]').textContent(), '22');
  assert.match(
    await focus
      .getByRole('region', { name: 'Selected day activities', exact: true })
      .innerText(),
    /Sep 22 · 25 km · 1 activity/,
  );
  assert.doesNotMatch(
    await focus.innerText(),
    /Select a day to see its activities/,
  );

  assert.equal(await focus.locator('[data-comparison-row]').count(), 3);
  const typical = focus.getByRole('checkbox', {
    name: 'Historical range',
  });
  assert.equal(await typical.isChecked(), true);
  await focus.locator('[data-explorer-band]').waitFor();
  const info = focus.getByRole('button', {
    name: 'About historical range',
  });
  await info.focus();
  await page.getByRole('tooltip').waitFor();
  assert.match(
    await page.getByRole('tooltip').innerText(),
    /5th–95th percentile.*completed months from/,
  );
  assert.match(
    await page.getByRole('tooltip').innerText(),
    /beyond Sep 22.*not a forecast/,
  );
  await typical.uncheck();
  assert.equal(await focus.locator('[data-explorer-band]').count(), 0);
  await page.reload();
  await focus.waitFor();
  assert.equal(
    await typical.isChecked(),
    false,
    'Range preference survives a reload',
  );
  await typical.check();
  await page.reload();
  await focus.waitFor();
  assert.equal(await typical.isChecked(), true);
  await focus.locator('[data-explorer-band]').waitFor();
  const ticks = await focus
    .locator('[data-explorer-chart] svg text')
    .evaluateAll((nodes) =>
      ['1', '8', '15', '22', '29'].map((label) =>
        nodes
          .filter((node) => node.textContent === label)
          .map((node) => node.getAttribute('x')),
      ),
    );
  assert(
    ticks.every((pair) => pair.length === 2 && pair[0] === pair[1]),
    'Both date axes share exact plotting coordinates',
  );
  await focus.getByRole('button', { name: 'View all months' }).click();
  assert.equal(await focus.locator('[data-comparison-row]').count(), 12);
  await focus.getByRole('button', { name: 'View fewer months' }).click();
  const filterToggle = page.getByRole('button', {
    name: 'Filters',
    exact: true,
  });
  if ((await filterToggle.getAttribute('aria-expanded')) === 'false')
    await filterToggle.click();
  assert.equal(await page.locator('[data-month-more-filters]').count(), 0);
  assert.equal(
    await page
      .getByRole('textbox', { name: 'Distance filter value in km' })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole('button', { name: /Date range:/ }).count(),
    0,
  );
  assert.match(
    await page.locator('[data-filter-summary]').innerText(),
    /5 of 5 sports/,
  );
  console.log(
    'Month hierarchy, optional range, aligned axes, compact history and independent sport scope pass',
  );
  const row = focus.locator('[data-comparison-row]').nth(2);
  const key = await row.getAttribute('data-comparison-row');
  await row.hover();
  await focus.locator(`[data-explorer-series="${key}"]`).waitFor();
  assert.equal(await row.getAttribute('data-active'), 'true');
  await row.getByRole('button').click();
  await focus.getByRole('heading', { name: 'Recent months' }).hover();
  assert.equal(
    await focus.locator(`[data-explorer-series="${key}"]`).count(),
    1,
    'Click pins historical line',
  );
  await focus
    .locator(`[data-explorer-series="${key}"]`)
    .dispatchEvent('pointerenter');
  assert.equal(
    await row.getAttribute('data-active'),
    'true',
    'Line hover highlights its table row',
  );
  const day = focus.getByRole('button', { name: /Sep 22: / });
  await day.click();
  const chart = focus.locator('[data-explorer-chart]');
  const before = await chart.boundingBox();
  const selectedDay = await day.getAttribute('data-explorer-period');
  const activity = focus.locator('[data-stats-activity-id]').first();
  await activity.click();
  const panel = page.getByRole('region', { name: 'Activity detail panel' });
  await panel.waitFor();
  assert.equal(
    (await chart.boundingBox()).width,
    before.width,
    'Activity drawer preserves chart width',
  );
  assert.equal(
    await focus
      .locator(`[data-explorer-period="${selectedDay}"]`)
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.screenshot({
    path: join(output, 'month-activity-drawer.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert(
    await activity.evaluate((e) => e === document.activeElement),
    'Close returns focus to originating outing',
  );
  await load('year-to-date');
  assert.equal(
    await focus.getByRole('heading', { level: 1 }).innerText(),
    '2026 so far',
  );
  assert.equal(await focus.locator('[data-current-endpoint]').count(), 1);
  assert.equal(await focus.locator('[data-comparison-row]').count(), 3);
  const yearRange = focus.getByRole('checkbox', { name: 'Historical range' });
  assert.equal(await yearRange.isChecked(), true);
  await focus.getByRole('button', { name: 'About historical range' }).focus();
  await page.getByRole('tooltip').waitFor();
  assert.match(
    await page.getByRole('tooltip').innerText(),
    /minimum–maximum.*0th–100th percentiles.*not a forecast/,
  );
  await yearRange.uncheck();
  await page.reload();
  await focus.waitFor();
  assert.equal(await yearRange.isChecked(), false);
  await yearRange.check();
  const yearChoice = focus.getByRole('combobox', { name: 'Comparison year' });
  const older = await yearChoice
    .locator('option')
    .nth(1)
    .evaluate((option) => ({ key: option.value, year: option.textContent }));
  await yearChoice.selectOption(older.key);
  assert.match(
    await focus.locator('[data-explorer-chart]').innerText(),
    new RegExp(`Paired bars:|${older.year}`),
  );
  assert(
    (
      await focus
        .locator('[data-explorer-period]')
        .first()
        .getAttribute('aria-label')
    ).includes(`; ${older.year}:`),
  );
  assert.equal(
    await focus.locator(`[data-explorer-series="${older.key}"]`).count(),
    1,
  );
  assert.equal(
    await focus.locator('[data-selected-date]').textContent(),
    'Sep',
  );
  const yearChart = focus.locator('[data-explorer-chart]');
  const yearWidth = (await yearChart.boundingBox()).width;
  assert(yearWidth > 850, 'Year plot uses the primary content width');
  const yearActivity = focus.locator('[data-stats-activity-id]').first();
  await yearActivity.click();
  await panel.waitFor();
  assert.equal((await yearChart.boundingBox()).width, yearWidth);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await load('this-month');
  assert.equal(
    await typical.isChecked(),
    true,
    'Year and month range preferences are independent',
  );
  await load('training-volume');
  const volumeRow = focus.locator('[data-volume-row]').nth(3);
  const period = await volumeRow.getAttribute('data-volume-row');
  await volumeRow.hover();
  assert.equal(
    await focus
      .locator(`[data-explorer-period="${period}"]`)
      .getAttribute('data-active'),
    'true',
  );
  await volumeRow.getByRole('button').click();
  assert.equal(
    await focus
      .locator(`[data-explorer-period="${period}"]`)
      .getAttribute('aria-pressed'),
    'true',
  );
  const lastBar = focus.locator('[data-explorer-period]').last();
  await lastBar.hover();
  assert.equal(
    await focus
      .locator(
        `[data-volume-row="${await lastBar.getAttribute('data-explorer-period')}"]`,
      )
      .getAttribute('data-active'),
    'true',
  );
  await focus.getByRole('button', { name: 'By month', exact: true }).click();
  assert.match(
    await focus
      .getByRole('region', { name: 'Selected period activities', exact: true })
      .innerText(),
    /Sep 2026/,
  );
  await load('hilliness');
  await focus
    .getByRole('group', { name: 'Hilliness sport' })
    .getByRole('button', { name: 'Trail / Hike', exact: true })
    .click();
  assert.match(
    await focus
      .getByRole('region', { name: 'Selected month hilliness' })
      .innerText(),
    /Morning Hike/,
  );
  assert.doesNotMatch(
    await focus
      .getByRole('region', { name: 'Selected month hilliness' })
      .innerText(),
    /Lunch Ride/,
  );
  await focus.locator('[data-explorer-period]').first().click();
  assert.match(
    await focus
      .getByRole('region', { name: 'Selected month hilliness' })
      .innerText(),
    /No qualifying activities/,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: four expanded views at 1440/1024/402px, keyboard activation, linked hover/pinning, sport and period drill-down, stable activity drawer and focus return.',
  );
} catch (error) {
  await evidence.finish(error);
  throw error;
} finally {
  await evidence.finish();
  await browser.close();
}
