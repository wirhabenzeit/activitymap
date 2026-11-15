// Verifies real share dialogs, detail actions and List inspection against local
// fixture activities. Map hit results are supplied without a live Mapbox query.
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
const route = resolve('src/app/sharing-selection-test');
const output = resolve(process.argv[3] || '/tmp/activitymap-sharing-selection');
await mkdir(route); // Refuse to replace an existing developer route.
let browser, evidence, failure;
try {
  await writeFile(
    `${route}/page.tsx`,
    "export { default } from '../../../scripts/fixtures/sharing-selection';\n",
    { flag: 'wx' },
  );
  await waitForFixtureRoute(new URL('/sharing-selection-test', base));
  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  evidence = await recordBrowserEvidence(context, { base, output });
  const errors = [];
  const requests = [];
  let failNext = false;
  await context.route('**/api/v1/share-links', async (route) => {
    if (route.request().method() !== 'POST')
      return route.fulfill({
        json: {
          schemaVersion: '1',
          serverTime: new Date().toISOString(),
          data: { links: [] },
        },
      });
    requests.push(route.request().postDataJSON());
    if (failNext) {
      failNext = false;
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'fixture_failure',
            message: 'Try again',
            retryable: true,
            requestId: 'fixture',
          },
        },
      });
    }
    return route.fulfill({
      json: {
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        data: {
          id: 'jd7convexShareFixture',
          token: 'fixture-only-token',
          expiresAt: '2026-11-21T00:00:00.000Z',
        },
      },
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('/sharing-selection-test', base).href);
  await page.locator('[data-sharing-ready]').waitFor();
  await page.addStyleTag({
    content: 'nextjs-portal { display:none !important; }',
  });
  const header = page.locator('header');
  const dialog = page.getByRole('dialog');
  const close = () =>
    page
      .getByRole('button', { name: 'Close Share activities', exact: true })
      .click();
  const scope = () =>
    dialog
      .getByRole('list', { name: 'Activities to share' })
      .locator('li')
      .allTextContents();
  const groupShare = () =>
    page.getByRole('button', { name: /^Share \d+ selected activit/ });
  const activityActions = () =>
    page.getByRole('region', { name: 'Activity actions' });
  const openActivityShare = () =>
    activityActions()
      .getByRole('button', { name: /^Share activity/ })
      .click();
  const click = (name) =>
    page.getByRole('button', { name, exact: true }).click();
  assert.equal(
    await header.getByRole('button', { name: /Share/ }).count(),
    0,
    'The global header must not contain Share',
  );
  assert.equal(
    await groupShare().count(),
    0,
    'Map hits alone do not expose sharing',
  );
  assert.equal(await activityActions().count(), 0);

  await click('Open map detail 2');
  assert.equal(await groupShare().count(), 0);
  await openActivityShare();
  assert.equal((await scope()).length, 1);
  assert.match((await scope())[0], /Activity 2/);
  // Selection changes while configuring must never widen or replace the draft.
  await page.locator('#change-selection').evaluate((button) => button.click());
  assert.match((await scope())[0], /Activity 2/);
  failNext = true;
  await dialog
    .getByRole('button', { name: 'Create link', exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="dialog"] button')].some(
      (b) => b.textContent === 'Create link' && !b.disabled,
    ),
  );
  assert.deepEqual(requests.at(-1).activityIds, ['2']);
  await dialog
    .getByRole('button', { name: 'Create link', exact: true })
    .click();
  await dialog.getByRole('heading', { name: 'Link created' }).waitFor();
  assert.deepEqual(requests.at(-1).activityIds, ['2']);
  assert.match(
    await dialog.getByLabel('Share link', { exact: true }).inputValue(),
    /\/share\/fixture-only-token$/,
  );
  await close();

  await click('Restore selection');
  await click('Close map detail');
  await click('Enable Combine');
  await groupShare().click();
  assert.equal((await scope()).length, 4);
  await page.locator('#change-selection').evaluate((button) => button.click());
  assert.deepEqual(
    (await scope()).map((text) => text.match(/Activity \d/)[0]),
    ['Activity 1', 'Activity 2', 'Activity 3', 'Activity 4'],
  );
  await dialog.getByRole('button', { name: 'Your links', exact: true }).click();
  await dialog
    .getByRole('heading', { name: 'Your links', exact: true })
    .waitFor();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Create link', exact: true })
    .click();
  await dialog.getByRole('heading', { name: 'Link created' }).waitFor();
  assert.deepEqual(requests.at(-1).activityIds, ['1', '2', '3', '4']);
  await close();
  await click('Restore selection');

  await click('Open map detail 2');
  assert.equal(
    await groupShare().count(),
    0,
    'Map detail shares only its own activity',
  );
  await openActivityShare();
  assert.equal((await scope()).length, 1);
  await close();
  await click('Close map detail');
  await click('Disable Combine');
  assert.equal(
    await groupShare().count(),
    0,
    'Turning off selection mode removes group sharing',
  );
  await click('Enable Combine');
  await click('Clear group');
  assert.equal(
    await groupShare().count(),
    0,
    'An empty group has no share action',
  );
  await click('Restore selection');

  await click('Switch surface');
  await page.locator('[data-list-inspection-ready="true"]').waitFor();
  await click('Go to next page');
  await page.locator('#table-main [data-activity-id="5"]').click();
  await activityActions().waitFor();
  // In List, the selection footer remains a clearly separate group action.
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await groupShare().boundingBox();
    assert(
      bounds &&
        bounds.x >= 0 &&
        bounds.x + bounds.width <= width + 1 &&
        bounds.height >= 44,
      `Selection Share does not fit at ${width}`,
    );
    await groupShare().click();
    assert.equal((await scope()).length, 4);
    await close();
    await activityActions().scrollIntoViewIfNeeded();
    for (const label of [
      'Edit',
      'Share activity',
      'Download GPX',
      'Open in Strava',
    ]) {
      const control =
        label === 'Open in Strava'
          ? activityActions().getByRole('link', { name: new RegExp(label) })
          : activityActions().getByRole('button', { name: new RegExp(label) });
      const box = await control.boundingBox();
      assert(
        box &&
          box.width > 44 &&
          box.height >= 44 &&
          box.x >= 0 &&
          box.x + box.width <= width + 1,
        `${label} does not fit at ${width}`,
      );
    }
    await page.screenshot({ path: `${output}/actions-${width}.png` });
  }
  await openActivityShare();
  assert.equal((await scope()).length, 1);
  assert.match((await scope())[0], /Activity 5/);
  await dialog
    .getByRole('button', { name: 'Create link', exact: true })
    .click();
  await dialog.getByRole('heading', { name: 'Link created' }).waitFor();
  assert.deepEqual(requests.at(-1).activityIds, ['5']);
  await close();
  await click('Disable Combine');
  assert.equal(await groupShare().count(), 0);
  assert.equal(
    await activityActions()
      .getByRole('button', { name: /^Share activity/ })
      .count(),
    1,
  );
  await click('Enable Combine');
  await click('Become guest');
  assert.equal(await header.getByRole('button', { name: /Share/ }).count(), 0);
  assert.equal(await groupShare().count(), 0);
  assert.equal(
    await activityActions()
      .getByRole('button', { name: /^Share activity/ })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Passed: no global Share, contextual activity/group controls, frozen drafts and retries, API payloads, 320/390/1440px layouts, guest visibility.',
  );
} catch (error) {
  failure = error;
  throw error;
} finally {
  await evidence?.finish(failure);
  await browser?.close();
  await rm(route, { recursive: true });
}
