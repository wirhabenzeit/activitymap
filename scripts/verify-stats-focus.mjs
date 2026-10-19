// Real shell, charts, URL/history and adaptive activity inspection against local DTOs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  cleanupBrowserFixture,
  prepareBrowserFixture,
} from './quality/browser-fixtures.mjs';
import {
  launchBrowser,
  recordBrowserEvidence,
  waitForFixtureRoute,
} from './quality/browser-support.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Use a local dev server',
);
const output = resolve(process.argv[3] || '/tmp/activitymap-stats-focus');
const fixtureRoot = resolve(import.meta.dirname, '..');
await prepareBrowserFixture(fixtureRoot, 'stats');
await mkdir(output, { recursive: true });
let browser;
let evidence;
let failure;
try {
  await waitForFixtureRoute(new URL('/stats-focus-test', base));
  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    locale: 'en-US',
  });
  evidence = await recordBrowserEvidence(context, { base, output });
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
    const compactCalendarSize = await card('activityCalendar').evaluate(
      (el) => {
        const cell = el.querySelector('[data-calendar-day]');
        return {
          weeks: el.querySelectorAll('[data-calendar-week]').length,
          cellWidth: cell?.getBoundingClientRect().width ?? 0,
          cellHeight: cell?.getBoundingClientRect().height ?? 0,
          monthSeparatorWidth: el
            .querySelector('[data-calendar-month-boundary] > span:last-child')
            ?.getBoundingClientRect().width,
          fits:
            el.scrollWidth <= el.clientWidth &&
            el.scrollHeight <= el.clientHeight,
          text: el.innerText,
          countSharesControls: Boolean(
            el.querySelector('[data-calendar-summary-header] [role="group"]'),
          ),
        };
      },
    );
    assert(compactCalendarSize.weeks >= 4 && compactCalendarSize.weeks <= 52);
    assert(
      compactCalendarSize.cellWidth >= 14 &&
        compactCalendarSize.cellWidth <= 18.1,
    );
    assert(compactCalendarSize.fits, 'The compact calendar fits its tile');
    assert(
      compactCalendarSize.countSharesControls,
      'The active-day count shares a row with the calendar controls',
    );
    assert(!compactCalendarSize.text.includes('Recent activity'));
    assert.equal(
      compactCalendarSize.monthSeparatorWidth,
      6,
      'Month separators remain visible in the compact calendar',
    );
    assert.equal(
      compactCalendarSize.cellWidth,
      compactCalendarSize.cellHeight,
      'Compact calendar days are square',
    );
    assert(
      compactCalendarSize.text.includes(
        `last ${compactCalendarSize.weeks} weeks`,
      ),
    );
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
      if (id === 'activityCalendar') {
        assert(
          await focus.locator('[data-calendar-day]').evaluateAll((cells) =>
            cells.every((cell) => {
              const bounds = cell.getBoundingClientRect();
              return bounds.width === bounds.height;
            }),
          ),
          `Expanded calendar days are square at ${width}×${height}`,
        );
        const lastDay = focus.locator('[data-calendar-day]').last();
        await lastDay.click();
        const rightInset = await lastDay.evaluate((cell) => {
          const viewport = cell
            .closest('[data-calendar-scroll]')
            .getBoundingClientRect();
          return viewport.right - cell.getBoundingClientRect().right;
        });
        assert(
          rightInset >= 3,
          'The rightmost selection outline fits inside the calendar viewport',
        );
        await focus.getByRole('button', { name: 'Close day details' }).click();
      }
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
  // Focus Back names and returns to the immediate chart while inspecting.
  await focus
    .getByRole('button', { name: 'Back to Records', exact: true })
    .click();
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
    .getByRole('button', { name: 'Back to Records', exact: true })
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
  for (const dismiss of ['close', 'escape', 'header']) {
    await loaded();
    await loaded(new URL(activityURL).search);
    await dialog.waitFor();
    const initialID = new URL(activityURL).searchParams.get('activity');
    await focus
      .locator(
        `[data-stats-activity-id]:visible:not([data-stats-activity-id="${initialID}"])`,
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
    else if (dismiss === 'header')
      await focus
        .getByRole('button', { name: 'Back to Records', exact: true })
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

  // Weekday rows browse continuous history, including years outside the face.
  await loaded('?tile=activity-calendar');
  const calendarScroll = focus.locator('[data-calendar-scroll]');
  assert.equal(
    await focus.getByRole('combobox', { name: 'Calendar period' }).count(),
    0,
  );
  assert.equal(
    await calendarScroll.locator('[data-calendar-day]').count(),
    1263,
  );
  assert(
    await calendarScroll.evaluate((el) => el.scrollWidth > el.clientWidth),
  );
  assert(await calendarScroll.evaluate((el) => el.scrollLeft > 0));
  // Clicking a visible day must preserve the timeline, including when the
  // details appear at the wide-layout breakpoint. Month overlays make the
  // button's offsetParent a week column rather than the scroll viewport.
  for (const width of [1440, 402]) {
    await page.setViewportSize({ width, height: 1000 });
    await calendarScroll.evaluate((el) => {
      el.scrollLeft = 1200;
    });
    const before = await calendarScroll.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const cell = [...el.querySelectorAll('[data-calendar-day]')].find(
        (cell) => {
          const box = cell.getBoundingClientRect();
          return (
            box.left > bounds.left + bounds.width / 2 &&
            box.right < bounds.right
          );
        },
      );
      return {
        left: el.scrollLeft,
        width: el.clientWidth,
        day: cell?.getAttribute('data-calendar-day'),
      };
    });
    assert(before.day, 'A visible day is available');
    await calendarScroll.locator(`[data-calendar-day="${before.day}"]`).click();
    await focus
      .getByRole('region', { name: 'Selected day activities' })
      .waitFor();
    assert.deepEqual(
      await calendarScroll.evaluate((el) => ({
        left: el.scrollLeft,
        width: el.clientWidth,
      })),
      { left: before.left, width: before.width },
      `Selecting a day preserves calendar position at ${width}px`,
    );
    await focus.getByRole('button', { name: 'Close day details' }).click();
    assert.equal(
      await calendarScroll.evaluate((el) => el.scrollLeft),
      before.left,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await calendarScroll.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const firstDay = calendarScroll.locator('[data-calendar-day]').first();
  await firstDay.click();
  await focus
    .getByRole('region', { name: 'Selected day activities' })
    .waitFor();
  assert.match(await firstDay.getAttribute('aria-label'), /Apr 9, 2023/);
  const firstNumber = Number(await firstDay.getAttribute('data-calendar-day'));
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(() =>
      Number(document.activeElement.dataset.calendarDay),
    ),
    firstNumber + 7,
  );
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page.evaluate(() =>
      Number(document.activeElement.dataset.calendarDay),
    ),
    firstNumber + 8,
  );
  await page.keyboard.press('Enter');
  await page.screenshot({
    path: join(output, 'calendar-history-start.png'),
    animations: 'disabled',
  });
  await focus.getByRole('button', { name: 'Close day details' }).click();
  await calendarScroll.evaluate((el) => {
    el.scrollLeft = 1200;
  });
  await page.waitForTimeout(100);
  const savedCalendarScroll = await calendarScroll.evaluate(
    (el) => el.scrollLeft,
  );
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await active(null);
  await card('activityCalendar').screenshot({
    path: join(output, 'calendar-compact.png'),
    animations: 'disabled',
  });
  await card('activityCalendar')
    .getByRole('button', { name: /^Expand / })
    .click();
  await active('activity-calendar');
  assert.equal(
    await calendarScroll.evaluate((el) => el.scrollLeft),
    savedCalendarScroll,
  );
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await active(null);
  console.log(
    'Weekday alignment, cross-year scrolling, day selection, keyboard navigation and retained scroll pass',
  );

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
  await page.setViewportSize({ width: 402, height: 874 });
  await loaded('?tile=training-volume');
  await focus.getByRole('button', { name: 'Elevation', exact: true }).click();
  await focus.getByRole('combobox', { name: 'Volume grouping' }).click();
  await page.getByRole('option', { name: 'By month', exact: true }).click();
  const focusScroller = focus.locator('[data-stats-focus-scroll]');
  const savedFocusScroll = await focusScroller.evaluate((element) => {
    element.scrollTop = 200;
    return element.scrollTop;
  });
  await page.waitForTimeout(100);
  const togglePeer = () =>
    page.locator('#test-peer-destination').evaluate((button) => button.click());
  await togglePeer();
  await page.locator('[data-stats-dashboard]').waitFor({ state: 'detached' });
  await togglePeer();
  await focus.waitFor();
  assert.equal(
    await focus
      .getByRole('button', { name: 'Elevation', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await focus.getByRole('combobox', { name: 'Volume grouping' }).innerText(),
    'By month',
  );
  // Other tile focus surfaces stay mounted but hidden. Bind to the visible
  // scroller after remount, rather than the first hidden tile in document order.
  await page.waitForFunction(
    ({ element, top }) => Math.abs(element.scrollTop - top) < 2,
    { element: await focusScroller.elementHandle(), top: savedFocusScroll },
  );
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await active(null);
  const savedDashboardScroll = await dashboard.evaluate((element) => {
    element.scrollTop = 350;
    return element.scrollTop;
  });
  await page.waitForTimeout(100);
  await togglePeer();
  await page.locator('[data-stats-dashboard]').waitFor({ state: 'detached' });
  await togglePeer();
  await dashboard.waitFor();
  await page.waitForTimeout(500);
  await page.waitForFunction(
    (top) =>
      Math.abs(
        document.querySelector('[data-stats-dashboard]').scrollTop - top,
      ) < 2,
    savedDashboardScroll,
  );
  console.log(
    'Peer destinations retain Stats metric, grouping, chart/dashboard scroll',
  );

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
} catch (error) {
  failure = error;
  throw error;
} finally {
  await evidence?.finish(failure);
  await browser?.close();
  await cleanupBrowserFixture(fixtureRoot, 'stats');
}
