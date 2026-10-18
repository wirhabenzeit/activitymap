// Run against this checkout's local Next dev server. Uses the real list, detail,
// sidebar and URL hook with fixture DTOs; creates/removes only its own test route.
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
const output = resolve(process.argv[3] || '/tmp/activitymap-list-inspection');
const route = resolve(import.meta.dirname, '../src/app/list-inspection-test');
await mkdir(route); // Refuse to overwrite any existing route.
await mkdir(output, { recursive: true });
let browser;
let evidence;
let failure;
try {
  await writeFile(
    join(route, 'page.tsx'),
    `
'use client';
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityListView } from '~/components/list/activity-list';
import { AppSidebar } from '~/components/layout/app-sidebar';
import { AppHeader } from '~/components/layout/app-header';
import { SidebarProvider } from '~/components/ui/sidebar';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { activityDTOSchema } from '~/contracts/v1/activity';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
const defaults = Object.fromEntries(Object.keys(activityDTOSchema.shape).filter(key => key !== 'streams').map(key => [key, null]));
function FixtureList() {
  const dense = useSearchParams().has('dense');
  const activities = useMemo(() => {
    const raw = dense ? Array.from({length:205}, (_, index) => ({...fixture.activities[0], id:String(index+1), name:'Activity '+String(index+1).padStart(3,'0')})) : fixture.activities;
    return raw.map(item => dtoToActivity(activityDTOSchema.parse({...defaults, ...item})));
  }, [dense]);
  const { filterIDs } = useFilteredActivities(activities);
  return <ActivityListView activities={activities} filterIDs={filterIDs} />;
}
export default function Review() {
  const [client] = useState(() => new QueryClient());
  const [shown, setShown] = useState(true);
  return <Suspense><QueryClientProvider client={client}><SidebarProvider className="flex h-dvh flex-col"><AppHeader /><div className="flex min-h-0 flex-1 overflow-hidden"><AppSidebar /><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><div className="h-14 w-full shrink-0"/><div className="min-h-0 w-full flex-1 overflow-hidden"><button id="test-peer-destination" className="sr-only" onClick={() => setShown(value => !value)}>Switch destination</button>{shown ? <FixtureList /> : <div>Map destination</div>}</div></main></div></SidebarProvider></QueryClientProvider></Suspense>;
}
`,
  );
  await waitForFixtureRoute(new URL('/list-inspection-test', base));
  browser = await launchBrowser();
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'Europe/Zurich',
  });
  evidence = await recordBrowserEvidence(context, { base, output });
  await context.addInitScript(() => {
    localStorage.setItem('theme', 'light');
    localStorage.removeItem('activitymap-ui-state');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  const path = '/list-inspection-test';
  const detail = page.locator('[data-detail-presentation]');
  const row = (id) => page.locator(`#table-main [data-activity-id="${id}"]`);
  const id = () => new URL(page.url()).searchParams.get('activity');
  const loaded = async (query = '') => {
    const response = await page.goto(new URL(path + query, base).href, {
      timeout: 120000,
    });
    assert(response?.ok(), `Navigation failed: ${response?.status()}`);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-list-inspection-ready="true"]') &&
        document.querySelectorAll('#table-main tbody tr[data-activity-id]')
          .length > 0,
    );
    await page.addStyleTag({
      content:
        'nextjs-portal, .tsqd-parent-container { display:none !important; }',
    });
  };
  const waitID = async (wanted) => {
    await page.waitForFunction(
      (wanted) =>
        new URL(location.href).searchParams.get('activity') === wanted,
      wanted,
    );
  };
  const assertMode = async (mode) => {
    await page.waitForFunction(
      (mode) =>
        document
          .querySelector('[data-detail-presentation]')
          ?.getAttribute('data-detail-presentation') === mode,
      mode,
    );
  };
  const firstID = '20279947341';
  for (const [width, height, mode] of [
    [1440, 1000, 'panel'],
    [1024, 768, 'panel'],
    [760, 768, 'push'],
    [402, 874, 'push'],
  ]) {
    await page.setViewportSize({ width, height });
    await loaded();
    await row(firstID).focus();
    const history = await page.evaluate(
      () => window.navigation.currentEntry.index,
    );
    await page.keyboard.press('Enter');
    await waitID(firstID);
    await assertMode(mode);
    assert.equal(
      await page.evaluate(() => window.navigation.currentEntry.index),
      history + 1,
    );
    assert(
      await page.evaluate(
        () => !!window.history.state.activityListDetail?.returnTo,
      ),
    );
    assert.equal(
      await page
        .locator('#table-main')
        .evaluate((table) => !!table.closest('[inert]')),
      mode === 'push',
    );
    if (mode === 'panel') {
      assert.equal(await row(firstID).getAttribute('data-state'), 'false');
      assert.equal(await row(firstID).getAttribute('aria-current'), 'true');
      assert.notEqual(
        await row(firstID).evaluate(
          (row) => getComputedStyle(row.cells[0]).boxShadow,
        ),
        'none',
        'Inspection has a leading marker distinct from selection',
      );
      const geometry = await page.evaluate(() => {
        const panel = document
          .querySelector('[data-detail-presentation]')
          .getBoundingClientRect();
        const table = document
          .querySelector('#table-main')
          .getBoundingClientRect();
        return {
          panel: panel.toJSON(),
          table: table.toJSON(),
          columns:
            document.querySelector('#table-main').style.gridTemplateColumns,
        };
      });
      assert(geometry.panel.width >= 420 && geometry.panel.width <= 520);
      assert(geometry.table.right <= geometry.panel.left + 1);
      // Date stays visible despite its lower position in the column catalogue.
      assert(
        (await page
          .locator('#table-main thead')
          .getByRole('button', { name: 'Date' })
          .count()) ||
          (await page.locator('#table-main thead svg.lucide-calendar').count()),
      );
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.screenshot({
      path: join(output, `web-list-detail--${width}x${height}.png`),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await waitID(null);
    await page.waitForFunction(
      () => !document.querySelector('[data-detail-presentation]'),
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('data-activity-id'),
      ),
      firstID,
    );
    console.log(
      `PASS ${width}x${height}: ${mode}, URL history, keyboard open/close, focus return`,
    );
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await loaded('?dense=1');
  const widthLabels = ['Fit to width', 'Scroll, name pinned', 'Scroll freely'];
  const widthButton = (label) =>
    page.locator('#table-main thead').getByRole('button', {
      name: new RegExp(`^${label}\\. Switch to:`),
    });
  const assertWidthBehavior = async (label) => {
    await widthButton(label).waitFor();
    const geometry = await page.locator('#table-main').evaluate((table) => {
      const scroller = table.parentElement;
      const name = table
        .querySelector('[aria-label="Sort by Name"]')
        .closest('th');
      scroller.scrollLeft = 0;
      const before = name.getBoundingClientRect().left;
      scroller.scrollLeft = 120;
      const moved = before - name.getBoundingClientRect().left;
      const result = {
        overflowX: getComputedStyle(scroller).overflowX,
        scrollLeft: scroller.scrollLeft,
        namePosition: getComputedStyle(name).position,
        moved,
      };
      scroller.scrollLeft = 0;
      return result;
    });
    if (label === 'Fit to width') {
      assert.equal(geometry.overflowX, 'hidden');
      await page
        .locator('#table-main')
        .getByRole('button', {
          name: 'Sort by Date',
          exact: true,
        })
        .waitFor();
    } else {
      assert.notEqual(geometry.overflowX, 'hidden');
      assert(
        geometry.scrollLeft > 0,
        'Scrolling modes expose overflowing columns',
      );
      if (label === 'Scroll, name pinned') {
        assert.equal(geometry.namePosition, 'sticky');
        assert(
          Math.abs(geometry.moved) < 1,
          'Pin keeps Name fixed while scrolling',
        );
        await assertPinnedCoverage();
      } else {
        assert.notEqual(geometry.namePosition, 'sticky');
        assert(geometry.moved > 0, 'Scroll lets Name move with the table');
      }
    }
  };
  const assertPinnedCoverage = async () => {
    const coverage = await page.locator('#table-main').evaluate((table) => {
      const scroller = table.parentElement;
      scroller.scrollLeft = 140;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const cells = [
        table.querySelector('thead th'),
        table.querySelector('tbody tr[aria-current="true"] td'),
        table.querySelector('tbody tr[data-activity-id="204"] td'),
      ];
      const inspected = table.querySelector('tbody tr[aria-current="true"]');
      if (
        getComputedStyle(inspected.cells[0]).backgroundColor !==
        getComputedStyle(inspected.cells[1]).backgroundColor
      ) {
        throw new Error(
          'Pinned Name retains the same inspection tint as the other cells',
        );
      }
      const result = cells.map((cell) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(cell).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const bounds = cell.getBoundingClientRect();
        return {
          alpha: context.getImageData(0, 0, 1, 1).data[3],
          coversScrollingCells:
            document
              .elementFromPoint(
                bounds.right - 12,
                bounds.top + bounds.height / 2,
              )
              ?.closest('td, th') === cell,
        };
      });
      scroller.scrollLeft = 0;
      return result;
    });
    for (const cell of coverage) {
      assert.equal(
        cell.alpha,
        255,
        'Pinned cells fully cover content underneath',
      );
      assert(
        cell.coversScrollingCells,
        'Pinned cells paint above scrolling cells',
      );
    }
  };
  for (const [index, label] of widthLabels.entries()) {
    await widthButton(label).waitFor();
    await row(205).click();
    await waitID('205');
    await assertMode('panel');
    await assertWidthBehavior(label);
    await page.setViewportSize({ width: 760, height: 768 });
    await assertMode('push');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertMode('panel');
    await assertWidthBehavior(label);
    await widthButton(label).click();
    const next = widthLabels[(index + 1) % widthLabels.length];
    await assertWidthBehavior(next);
    await page
      .getByRole('button', {
        name: 'Close activity detail',
        exact: true,
      })
      .click();
    await waitID(null);
    await widthButton(next).waitFor();
  }
  // The menu reflects the same mode and can change it with detail open too.
  await row(205).click();
  await waitID('205');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Scrolling', exact: true }).hover();
  assert.equal(
    await page
      .getByRole('menuitemcheckbox', {
        name: 'Fit to width',
        exact: true,
      })
      .getAttribute('aria-checked'),
    'true',
  );
  await page
    .getByRole('menuitemcheckbox', {
      name: 'Scroll freely',
      exact: true,
    })
    .click();
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  assert.equal(id(), '205', 'Changing the width mode leaves detail open');
  await assertWidthBehavior('Scroll freely');
  await page
    .getByRole('button', {
      name: 'Close activity detail',
      exact: true,
    })
    .click();
  await waitID(null);
  await widthButton('Scroll freely').click(); // Restore Fit for the remaining checks.
  await widthButton('Fit to width').waitFor();
  console.log(
    'PASS Fit/Pin/Scroll survive opening, resize and closing; header and menu changes take effect',
  );

  await widthButton('Fit to width').click();
  await page
    .getByRole('button', { name: 'Combine selections', exact: true })
    .click();
  await row(205).click();
  await waitID('205');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, theme);
    for (const selected of [false, true]) {
      if (selected) {
        await row(205)
          .getByRole('button', { name: /^(Select|Deselect) Activity 205$/ })
          .click();
        await page.waitForFunction(
          () =>
            document
              .querySelector('#table-main [data-activity-id="205"]')
              ?.getAttribute('data-state') === 'selected',
        );
      }
      await assertPinnedCoverage();
      await page.locator('#table-main').evaluate((table) => {
        table.parentElement.scrollLeft = 140;
      });
      await page.screenshot({
        path: join(
          output,
          `web-list-pinned--${theme}${selected ? '-selected' : ''}.png`,
        ),
      });
    }
    await row(205)
      .getByRole('button', { name: /^(Select|Deselect) Activity 205$/ })
      .click();
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.querySelector('#table-main').parentElement.scrollLeft = 0;
  });
  await page
    .getByRole('button', { name: 'Close activity detail', exact: true })
    .click();
  await waitID(null);
  await widthButton('Scroll, name pinned').click();
  await widthButton('Scroll freely').click();
  await widthButton('Fit to width').waitFor();
  console.log(
    'PASS pinned header, inspected and selected cells cover scrolled content in light/dark themes',
  );

  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Columns', exact: true }).hover();
  await page
    .getByRole('menuitemcheckbox', { name: 'Date', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .locator('#table-main')
      .getByRole('button', { name: 'Sort by Date', exact: true })
      .count(),
    0,
  );
  await row(205).click();
  await waitID('205');
  assert.equal(
    await page
      .locator('#table-main')
      .getByRole('button', { name: 'Sort by Date', exact: true })
      .count(),
    1,
  );
  await page
    .getByRole('button', { name: 'Go to next page', exact: true })
    .click();
  await row(5).waitFor();
  assert.equal(await row(205).count(), 0);
  await page.keyboard.press('Escape');
  await waitID(null);
  await row(205).waitFor();
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('data-activity-id'),
    ),
    '205',
  );
  assert.equal(
    await page
      .locator('#table-main')
      .getByRole('button', { name: 'Sort by Date', exact: true })
      .count(),
    0,
  );
  await page
    .locator('#table-main')
    .getByRole('button', { name: 'Sort by Name', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('#table-main tbody tr')
        ?.getAttribute('data-activity-id') === '1',
  );
  await row(2).click();
  await waitID('2');
  await page.keyboard.press('ArrowDown');
  await waitID('3');
  await page.keyboard.press('Escape');
  await waitID(null);
  assert.equal(
    await page
      .locator('#table-main tbody tr')
      .first()
      .getAttribute('data-activity-id'),
    '1',
  );
  await row(100).focus();
  const inspectedRowIsVisible = () =>
    row(100).evaluate((element) => {
      const scroller = element.closest('table').parentElement;
      const bounds = scroller.getBoundingClientRect();
      const header = scroller.querySelector('thead').getBoundingClientRect();
      const item = element.getBoundingClientRect();
      return item.top >= header.bottom && item.bottom <= bounds.bottom;
    });
  assert(
    await inspectedRowIsVisible(),
    'Focused row is visible before inspection',
  );
  await page.keyboard.press('Enter');
  await waitID('100');
  await page.waitForFunction(
    () =>
      document
        .querySelector('#table-main [data-activity-id="100"]')
        ?.getAttribute('aria-current') === 'true',
  );
  // Opening reserves the saved-hidden Date column and styles the inspected row.
  // These layout changes can anchor scroll differently across platforms. Closing
  // must retain the settled open offset exactly and return focus to that row.
  const scrollBeforeClose = await row(100).evaluate(async (element) => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return element.closest('table').parentElement.scrollTop;
  });
  assert(await inspectedRowIsVisible(), 'Inspected row stays visible');
  await page.keyboard.press('Escape');
  await waitID(null);
  await detail.waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('data-activity-id'),
    ),
    '100',
    'Closing returns keyboard focus to the inspected row',
  );
  assert(await inspectedRowIsVisible(), 'Returned row stays visible');
  assert.equal(
    await page
      .locator('#table-main')
      .evaluate((table) => table.parentElement.scrollTop),
    scrollBeforeClose,
    'Closing retains the exact settled inspection scroll offset',
  );
  console.log(
    'PASS saved columns, sorted stepping order, retained scroll and focus after paging away',
  );
  await loaded('?dense=1&other=keep#anchor');
  const history = await page.evaluate(
    () => window.navigation.currentEntry.index,
  );
  await row(6).focus(); // Last row of page 1 (descending ID, 200 per page).
  await page.keyboard.press('Enter');
  await waitID('6');
  await page.keyboard.press('ArrowDown');
  await waitID('5');
  await row(5).waitFor();
  assert.equal(await row(6).count(), 0);
  assert.equal(await row(5).getAttribute('aria-current'), 'true');
  await page.keyboard.press('ArrowUp');
  await waitID('6');
  await row(6).waitFor();
  const inView = await row(6).evaluate((row) => {
    const scroller = document.querySelector('#table-main').parentElement;
    const bounds = scroller.getBoundingClientRect(),
      item = row.getBoundingClientRect();
    return item.bottom <= bounds.bottom + 1 && item.top >= bounds.top;
  });
  assert(inView, 'Stepping scrolls inspected row into view');
  await page
    .getByRole('button', { name: 'Previous activity', exact: true })
    .click();
  await waitID('7');
  await row(205).click();
  await waitID('205');
  assert.equal(await detail.count(), 1, 'Inspectors never stack');
  assert.equal(
    await page.evaluate(() => window.navigation.currentEntry.index),
    history + 1,
  );
  assert.equal(new URL(page.url()).searchParams.get('other'), 'keep');
  assert.equal(new URL(page.url()).hash, '#anchor');
  await page.reload();
  await assertMode('panel');
  assert.equal(id(), '205');
  await page.setViewportSize({ width: 760, height: 768 });
  await assertMode('push');
  assert.equal(id(), '205');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await assertMode('panel');
  assert.equal(id(), '205', 'Resizing retains the inspected activity');
  assert.equal(
    await page.evaluate(() => window.navigation.currentEntry.index),
    history + 1,
  );
  assert.equal(
    await page
      .locator('#table-main')
      .evaluate((table) => !!table.closest('[inert]')),
    false,
    'Widening restores the interactive list',
  );
  await row(204).click();
  await waitID('204');
  await row(205).click();
  await waitID('205');
  await page.keyboard.press('Escape');
  await waitID(null);
  await row(205).focus();
  await page.keyboard.press('Enter');
  await assertMode('panel');
  await page
    .getByRole('button', { name: 'More route actions', exact: true })
    .click();
  await page.keyboard.press('ArrowDown');
  assert.equal(id(), '205');
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal(
    id(),
    '205',
    'Escape in the actions menu only dismisses the menu',
  );
  await page
    .getByRole('button', { name: 'More route actions', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('ArrowDown');
  assert.equal(id(), '205');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(id(), '205', 'Escape in Edit only dismisses the dialog');
  assert(
    await detail
      .getByRole('button', { name: 'Show Activity 205 on map', exact: true })
      .isEnabled(),
  );
  console.log('PASS actions menu and Edit keep their own keyboard handling');
  console.log(
    'PASS stepping across pages, one inspector, reload, query preservation and list restoration on widening',
  );

  // Selection survives an inspection round trip; sorting and filtering define
  // stepping order, including when a saved hidden Date column is overridden.
  await page.keyboard.press('Escape');
  await waitID(null);
  const combineControl = page.getByRole('button', {
    name: 'Combine selections',
    exact: true,
  });
  if ((await combineControl.getAttribute('aria-pressed')) !== 'true')
    await combineControl.click();
  await row(205)
    .getByRole('button', { name: /^(Select|Deselect) Activity 205$/ })
    .click();
  const selectedBefore = await row(205).getAttribute('data-state');
  await page.getByPlaceholder('Search activities').fill('Activity 00');
  await row(9).waitFor();
  await row(9).click();
  await waitID('9');
  await page
    .getByRole('button', { name: 'Next activity', exact: true })
    .click();
  await waitID('8');
  await page.getByPlaceholder('Search activities').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(id(), '8', 'Editing filters must not step the inspector');
  await page.getByPlaceholder('Search activities').fill('Activity 205');
  await waitID(null);
  assert.equal(await row(205).getAttribute('data-state'), selectedBefore);
  console.log(
    'PASS selection independence, filter stepping order and filter dismissal',
  );

  // Browser Back on a push returns to the retained list even after stepping
  // and widening. Forward restores that activity in the current layout.
  await page.setViewportSize({ width: 402, height: 874 });
  await loaded('?dense=1');
  await row(205).focus();
  await page.keyboard.press('Enter');
  await waitID('205');
  await page
    .getByRole('button', { name: 'Next activity', exact: true })
    .click();
  await waitID('204');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await assertMode('panel');
  assert.equal(id(), '204');
  await page.goBack();
  await waitID(null);
  await page.goForward();
  await waitID('204');
  await assertMode('panel');
  await page
    .getByRole('button', { name: 'Close activity detail', exact: true })
    .click();
  await waitID(null);
  console.log(
    'PASS narrow-open Back/Forward and panel Close after stepping and widening',
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await loaded('?dense=1');
  await page
    .getByRole('button', { name: 'Go to next page', exact: true })
    .click();
  await row(5).waitFor();
  const togglePeer = () =>
    page.locator('#test-peer-destination').evaluate((button) => button.click());
  await togglePeer();
  await page.locator('#table-main').waitFor({ state: 'detached' });
  await togglePeer();
  await row(5).waitFor();
  assert.equal(
    await row(205).count(),
    0,
    'Page survives a peer destination round trip',
  );
  await page
    .getByRole('button', { name: 'Go to previous page', exact: true })
    .click();
  await row(205).waitFor();
  const savedScroll = await page.locator('#table-main').evaluate((table) => {
    table.parentElement.scrollTop = 600;
    return table.parentElement.scrollTop;
  });
  await page.waitForTimeout(100);
  await togglePeer();
  await page.locator('#table-main').waitFor({ state: 'detached' });
  await togglePeer();
  await row(205).waitFor();
  await page.waitForFunction(
    (top) =>
      Math.abs(
        document.querySelector('#table-main').parentElement.scrollTop - top,
      ) < 2,
    savedScroll,
  );
  await row(205).click();
  await waitID('205');
  await page.goBack();
  await waitID(null);
  await page.goForward();
  await waitID('205');
  await page.setViewportSize({ width: 402, height: 874 });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filters', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Filters', exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(id(), '205', 'Filter Escape leaves inspection open');
  assert.equal(
    await page
      .getByRole('button', { name: 'Filters', exact: true })
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await page.keyboard.press('Escape');
  await waitID(null);
  console.log(
    'PASS panel Back/Forward, peer destination page/scroll retention, filter-first Escape and focus return',
  );

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  await writeFile(
    join(output, 'verification.json'),
    JSON.stringify(
      {
        screenshots: [1440, 1024, 760, 402],
        browser: browser.version(),
        browserErrors: errors,
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`Evidence: ${output}`);
} catch (error) {
  failure = error;
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    console.error(
      await page.evaluate(() => ({
        url: location.href,
        rows: [...document.querySelectorAll('#table-main tbody tr')].map(
          (row) => row.getAttribute('data-activity-id'),
        ),
        detail: document
          .querySelector('[data-detail-presentation]')
          ?.textContent?.slice(0, 200),
        focus: document.activeElement?.outerHTML?.slice(0, 200),
      })),
    );
    await page.screenshot({ path: join(output, 'failure.png') });
  }
  throw error;
} finally {
  await evidence?.finish(failure);
  await browser?.close();
  await rm(route, { recursive: true, force: true });
  await rm(
    resolve(import.meta.dirname, '../.next/dev/types/app/list-inspection-test'),
    { recursive: true, force: true },
  );
}
