import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
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

const root = resolve(import.meta.dirname, '..');
const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Use an isolated local fixture',
);
const output = resolve(
  process.argv[3] || '/tmp/activitymap-accessibility-review',
);
const catalog = JSON.parse(
  await readFile(join(root, 'shared/presentation/catalog.v1.json'), 'utf8'),
);
const copy = (id) => catalog.messages[id].source;
let dto;
await prepareBrowserFixture(root, 'accessibility');
let browser, evidence, failure;
try {
  await waitForFixtureRoute(new URL('/accessibility-review-test', base));
  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  evidence = await recordBrowserEvidence(context, { base, output });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const load = async () => {
    await page.goto(new URL('/accessibility-review-test', base).href);
    await page.locator('[data-review-ready="true"]').waitFor();
    await page.addStyleTag({
      content: 'nextjs-portal { display:none !important; }',
    });
  };
  await load();
  dto = JSON.parse(
    await page.locator('script[data-review-activity]').textContent(),
  );
  const recorded = page.getByRole('region', {
    name: 'Recorded activity',
    exact: true,
    includeHidden: true,
  });
  const indoor = page.getByRole('region', {
    name: 'Activity without route',
    exact: true,
  });
  const more = (region) =>
    region.getByRole('button', { name: copy('actions.more'), exact: true });
  const dismissMenu = async (trigger) => {
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    const id = await trigger.getAttribute('id');
    await page.waitForFunction((id) => document.activeElement?.id === id, id);
  };
  const openEdit = async () => {
    const direct = recorded.getByRole('button', {
      name: copy('action.edit'),
      exact: true,
    });
    if (await direct.count()) {
      await direct.focus();
      await page.keyboard.press('Enter');
    } else {
      await more(recorded).focus();
      await page.keyboard.press('Enter');
      const edit = page.getByRole('menuitem', {
        name: copy('action.edit'),
        exact: true,
      });
      await edit.focus();
      await page.keyboard.press('Enter');
    }
    const dialog = page.getByRole('dialog', {
      name: copy('activity.edit.title'),
      exact: true,
    });
    await dialog.waitFor();
    return dialog;
  };
  const target = async (control) => {
    const box = await control.boundingBox();
    assert(
      box && box.width >= 44 && box.height >= 44,
      `Action target below 44px: ${JSON.stringify(box)}`,
    );
  };
  const previews = [];
  for (const [width, height, scale, direction] of [
    [390, 844, 1, 'ltr'],
    [844, 390, 1, 'ltr'],
    [1024, 768, 1, 'ltr'],
    [512, 768, 1, 'ltr'],
    [1440, 1000, 1, 'ltr'],
    [390, 844, 2, 'ltr'],
    [844, 390, 1.7, 'rtl'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      ({ scale, direction }) => {
        document.documentElement.style.fontSize = `${16 * scale}px`;
        document.documentElement.dir = direction;
      },
      { scale, direction },
    );
    // ResizeObserver-driven action labels commit after the new font/viewport
    // layout. Sample settled geometry, keeping the same minimum target check.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await target(more(recorded));
    const map = recorded.getByRole('button', { name: /^Show on map:/ });
    await target(map);
    const titleBounds = await recorded
      .getByText(dto.name, { exact: true })
      .boundingBox();
    assert(
      titleBounds && titleBounds.width >= 120,
      `Activity title compressed by actions: ${JSON.stringify(titleBounds)}`,
    );
    for (const action of [map, more(recorded)]) {
      const bounds = await action.boundingBox();
      assert(
        bounds &&
          (bounds.x + bounds.width <= titleBounds.x ||
            bounds.x >= titleBounds.x + titleBounds.width ||
            bounds.y + bounds.height <= titleBounds.y ||
            bounds.y >= titleBounds.y + titleBounds.height),
        'Activity actions must not overlap the title',
      );
    }
    assert(await map.isEnabled());
    assert(
      await indoor.getByRole('button', { name: /^Show on map:/ }).isDisabled(),
    );
    await more(recorded).focus();
    await page.keyboard.press('Enter');
    const membership = await page.getByRole('menuitem').allTextContents();
    assert(membership.some((label) => label.includes(copy('action.refresh'))));
    assert(
      membership.some((label) => label.includes(copy('action.exportGPX'))),
    );
    assert(
      membership.some((label) => label.includes(copy('action.openInStrava'))),
    );
    const hasMenuEdit = membership.some(
      (label) => label.trim() === copy('action.edit'),
    );
    assert.notEqual(
      hasMenuEdit,
      (await recorded
        .getByRole('button', { name: copy('action.edit'), exact: true })
        .count()) > 0,
      'Edit is present once, directly or in overflow',
    );
    await dismissMenu(more(recorded));
    await more(indoor).click();
    assert(
      await page
        .getByRole('menuitem', { name: copy('action.refresh'), exact: true })
        .isDisabled(),
    );
    assert(
      await page
        .getByRole('menuitem', {
          name: new RegExp(`^${copy('action.exportGPX')}`),
        })
        .isDisabled(),
    );
    await dismissMenu(more(indoor));
    const dialog = await openEdit();
    const bounds = await dialog.boundingBox();
    assert(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= width + 1 &&
        bounds.y + bounds.height <= height + 1,
      `Dialog exceeds viewport ${width}x${height}: ${JSON.stringify(bounds)}`,
    );
    assert.equal(
      await dialog.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ),
      false,
      'Text enlargement must wrap inside the dialog',
    );
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 3 === 0 ? 'Shift+Tab' : 'Tab');
      assert(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        'Keyboard focus stays inside Edit',
      );
    }
    const save = dialog.getByRole('button', {
      name: copy('activity.edit.save'),
      exact: true,
    });
    await save.scrollIntoViewIfNeeded();
    assert(await save.isVisible(), 'Save stays reachable at large text');
    await target(
      dialog.getByRole('button', {
        name: copy('activity.edit.close'),
        exact: true,
      }),
    );
    await page.screenshot({
      path: join(output, `edit-${width}x${height}-${scale}-${direction}.png`),
    });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert(
      await recorded.evaluate((element) =>
        element.contains(document.activeElement),
      ),
      'Dismissal returns focus to the source activity action',
    );
    previews.push({ width, height, scale, direction, bounds, membership });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '16px';
    document.documentElement.dir = 'ltr';
  });
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .getByRole('button', { name: 'Deny editing permission', exact: true })
      .evaluate((element) => element.click());
    const editButton = recorded.getByRole('button', { name: /^Edit/ });
    if (width > 520) {
      await editButton.waitFor();
      assert(await editButton.isDisabled());
      assert.equal(
        await editButton.getAttribute('title'),
        `${copy('permission.edit')} ${copy('permission.reconnect')}`,
      );
      assert.match(
        await editButton.getAttribute('aria-label'),
        /Editing isn’t allowed/,
      );
    } else await editButton.waitFor({ state: 'hidden' });
    await more(recorded).click();
    if (width < 520) {
      const editItem = page.getByRole('menuitem', { name: /^Edit/ });
      assert(await editItem.isDisabled());
      assert.equal(
        await editItem.getAttribute('title'),
        `${copy('permission.edit')} ${copy('permission.reconnect')}`,
      );
      assert.match(
        await editItem.getAttribute('aria-label'),
        /Editing isn’t allowed/,
      );
    }
    assert(
      await page
        .getByRole('menuitem', { name: copy('action.refresh'), exact: true })
        .isEnabled(),
      'Read access keeps Refresh available when write permission is denied',
    );
    await dismissMenu(more(recorded));
    await page
      .getByRole('button', { name: 'Restore unknown permissions', exact: true })
      .evaluate((element) => element.click());
    if (width > 520)
      assert(
        await recorded
          .getByRole('button', { name: copy('action.edit'), exact: true })
          .isEnabled(),
      );
    else {
      await more(recorded).click();
      assert(
        await page
          .getByRole('menuitem', { name: copy('action.edit'), exact: true })
          .isEnabled(),
      );
      await dismissMenu(more(recorded));
    }
  }
  console.log(
    'PASS denied write permission explains disabled direct/overflow Edit while Refresh remains available',
  );
  const combine = page.getByRole('button', {
    name: 'Combine selections',
    exact: true,
  });
  assert.equal(await combine.getAttribute('aria-pressed'), 'true');
  await combine.focus();
  await page.keyboard.press('Space');
  assert.equal(
    await combine.getAttribute('aria-pressed'),
    'false',
    'Combine exposes state beyond color',
  );
  await page.keyboard.press('Space');
  const filter = page.getByRole('region', {
    name: 'Sport filter states',
    exact: true,
  });
  const categoryName = copy(
    catalog.categories.find((category) => category.id === 'run').message,
  );
  const category = filter
    .locator('button[data-category-state]')
    .filter({ hasText: categoryName });
  await category.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  assert.equal(
    await category.getAttribute('aria-pressed'),
    'true',
    'Rapid keyboard toggles apply twice, rather than isolating a category',
  );
  assert.equal(
    await category.locator('svg.lucide-check').count(),
    1,
    'Selection has a visible non-color indicator',
  );
  await filter
    .getByRole('button', {
      name: `Choose ${categoryName} activity types`,
      exact: true,
    })
    .click();
  const sport = page.getByRole('menuitemcheckbox', {
    name: 'Run',
    exact: true,
  });
  await sport.focus();
  await page.keyboard.press('Space');
  assert.equal(await sport.getAttribute('aria-checked'), 'false');
  await dismissMenu(
    filter.getByRole('button', {
      name: `Choose ${categoryName} activity types`,
      exact: true,
    }),
  );
  assert.equal(await category.getAttribute('aria-pressed'), 'mixed');
  assert.equal(
    await category.locator('svg.lucide-minus').count(),
    1,
    'Mixed selection has a visible non-color indicator',
  );
  console.log(
    'PASS layout matrix, menu availability, keyboard focus and selected/mixed filter states',
  );
  let release;
  const writes = [];
  await context.route(`**/api/v1/activities/${dto.id}`, async (route) => {
    writes.push(route.request().postDataJSON());
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        data: { ...dto, ...writes.at(-1) },
      }),
    });
  });
  let dialog = await openEdit();
  await dialog
    .getByRole('textbox', { name: copy('activity.edit.name'), exact: true })
    .fill('A');
  await dialog
    .getByRole('textbox', {
      name: copy('activity.edit.description'),
      exact: true,
    })
    .fill('');
  await dialog
    .getByRole('button', { name: copy('activity.edit.save'), exact: true })
    .click();
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === text && button.disabled,
      ),
    copy('activity.edit.saving'),
  );
  await page.keyboard.press('Escape');
  assert(await dialog.isVisible(), 'Submitted edit blocks Escape dismissal');
  assert.equal(writes.length, 1, 'Pending state submits once');
  assert.deepEqual(writes[0], { name: 'A', description: '' });
  release();
  await dialog.waitFor({ state: 'hidden' });
  await recorded.getByText('A', { exact: true }).waitFor();
  assert.equal(
    await recorded.getByText(/User description with line breaks/).count(),
    0,
    'Committed empty description clears the visible activity',
  );
  console.log(
    'PASS one-character name, intentional description clearing and pending/committed UI',
  );
  await context.unroute(`**/api/v1/activities/${dto.id}`);
  await context.route(`**/api/v1/activities/${dto.id}`, (route) => {
    const changes = route.request().postDataJSON();
    writes.push(changes);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        data: { ...dto, name: 'Background server title', ...changes },
      }),
    });
  });
  dialog = await openEdit();
  await dialog
    .getByRole('textbox', {
      name: copy('activity.edit.description'),
      exact: true,
    })
    .fill('Description edited during background sync');
  await page
    .getByRole('button', {
      name: 'Simulate background update',
      exact: true,
      includeHidden: true,
    })
    .evaluate((element) => element.click());
  await recorded
    .getByText('Background server title', { exact: true })
    .waitFor();
  await dialog
    .getByRole('button', { name: copy('activity.edit.save'), exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(
    writes.at(-1),
    { description: 'Description edited during background sync' },
    'Background prop updates cannot turn an untouched name into an edit',
  );
  await context.unroute(`**/api/v1/activities/${dto.id}`);
  console.log('PASS draft baseline survives background library updates');
  let refreshes = 0;
  await context.route(`**/api/v1/activities/${dto.id}/refresh`, (route) => {
    refreshes++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        data: {
          activity: { ...dto, name: 'A', description: '' },
          photos: [],
          photos_status: 'partial',
          photos_error: {
            code: 'rate_limited',
            retryable: true,
            retry_after_seconds: 1,
          },
        },
      }),
    });
  });
  await more(recorded).click();
  await page
    .getByRole('menuitem', { name: copy('action.refresh'), exact: true })
    .click();
  await page
    .getByText(copy('mutation.partial.title'), { exact: true })
    .waitFor();
  assert.equal(
    refreshes,
    1,
    'Partial photo refresh is reported as a committed activity outcome',
  );
  await page
    .getByRole('button', {
      name: 'Fail next cache reconciliation',
      exact: true,
    })
    .click();
  await context.route(`**/api/v1/activities/${dto.id}`, (route) => {
    const changes = route.request().postDataJSON();
    writes.push(changes);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        data: { ...dto, name: 'A', description: '', ...changes },
      }),
    });
  });
  dialog = await openEdit();
  await dialog
    .getByRole('textbox', { name: copy('activity.edit.name'), exact: true })
    .fill('Cache recovery');
  await dialog
    .getByRole('button', { name: copy('activity.edit.save'), exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  await page
    .getByText(copy('mutation.cacheFailure.title'), { exact: true })
    .waitFor();
  const retryCache = page.getByRole('button', {
    name: copy('action.retry'),
    exact: true,
  });
  await target(retryCache);
  const closeNotice = page.locator('[toast-close]').last();
  await target(closeNotice);
  assert.equal(
    await closeNotice.getAttribute('aria-label'),
    copy('action.close'),
  );
  assert.equal(
    await closeNotice.locator('svg').getAttribute('aria-hidden'),
    'true',
  );
  await page.screenshot({ path: join(output, 'cache-recovery-notice.png') });
  await page
    .getByRole('button', {
      name: 'Fail next cache reconciliation',
      exact: true,
    })
    .evaluate((element) => element.click());
  await retryCache.click();
  await page.waitForFunction(
    () => document.querySelector('[data-cache-failures]')?.textContent === '2',
  );
  await page
    .getByText(copy('mutation.cacheFailure.title'), { exact: true })
    .waitFor();
  await retryCache.waitFor();
  await retryCache.click();
  await page
    .getByText(copy('mutation.success.title'), { exact: true })
    .waitFor();
  assert.equal(
    writes.length,
    3,
    'Retrying local reconciliation never resubmits the remote save',
  );
  console.log(
    'PASS partial photo outcome and local cache retry without a repeated remote save',
  );
  await context.unroute(`**/api/v1/activities/${dto.id}`);
  await context.route(`**/api/v1/activities/${dto.id}`, (route) =>
    route.fulfill({
      status: 429,
      headers: { 'Retry-After': '60' },
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        error: {
          code: 'rate_limited',
          message: 'Wait before saving again.',
          retryable: true,
          requestId: 'accessibility-request-429',
        },
      }),
    }),
  );
  dialog = await openEdit();
  await dialog
    .getByRole('textbox', { name: copy('activity.edit.name'), exact: true })
    .fill('Retry draft');
  await dialog
    .getByRole('button', { name: copy('activity.edit.save'), exact: true })
    .click();
  const alert = dialog.getByRole('alert');
  await alert.waitFor();
  assert.match(await alert.textContent(), /accessibility-request-429/);
  assert.match(await alert.textContent(), /Wait before saving again/);
  assert(
    await dialog
      .getByRole('button', { name: copy('activity.edit.save'), exact: true })
      .isDisabled(),
    'Retry-After prevents early resubmission',
  );
  assert.equal(
    await dialog
      .getByRole('textbox', { name: copy('activity.edit.name'), exact: true })
      .inputValue(),
    'Retry draft',
    'Remote failure retains the draft',
  );
  await page.screenshot({ path: join(output, 'actionable-save-error.png') });
  let discardPrompts = 0;
  const acceptDiscard = (prompt) => {
    discardPrompts++;
    void prompt.accept();
  };
  page.on('dialog', acceptDiscard);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  if (await dialog.isVisible()) await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  page.off('dialog', acceptDiscard);
  assert.equal(
    discardPrompts,
    1,
    'After dismissing the error toast, Escape reaches exactly one editor discard confirmation',
  );
  console.log(
    'PASS actionable rate-limit error, retained draft and layered Escape/discard',
  );
  await context.unroute(`**/api/v1/activities/${dto.id}`);
  await context.route(`**/api/v1/activities/${dto.id}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        error: {
          code: 'cache_commit_failed',
          message: 'Strava accepted the change; refresh to recover.',
          retryable: true,
          requestId: 'upstream-success-request',
          details: { upstreamSucceeded: true },
        },
      }),
    }),
  );
  await context.unroute(`**/api/v1/activities/${dto.id}/refresh`);
  await context.route(`**/api/v1/activities/${dto.id}/refresh`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        data: {
          activity: { ...dto, name: 'Recovered remote title', description: '' },
          photos: [],
          photos_status: 'complete',
          photos_error: null,
        },
      }),
    }),
  );
  dialog = await openEdit();
  await dialog
    .getByRole('textbox', { name: copy('activity.edit.name'), exact: true })
    .fill('Remote accepted draft');
  await dialog
    .getByRole('button', { name: copy('activity.edit.save'), exact: true })
    .click();
  await dialog.getByRole('alert').waitFor();
  assert.match(
    await dialog.getByRole('alert').textContent(),
    /upstream-success-request/,
  );
  assert(
    await dialog
      .getByRole('button', { name: copy('activity.edit.save'), exact: true })
      .isDisabled(),
    'Upstream success requires rereading, never resaving the draft',
  );
  await dialog
    .getByRole('button', { name: copy('action.refresh'), exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  await recorded.getByText('Recovered remote title', { exact: true }).waitFor();
  dialog = await openEdit();
  await dialog
    .getByRole('textbox', { name: copy('activity.edit.name'), exact: true })
    .fill('Discarded local draft');
  page.once('dialog', (prompt) => prompt.accept());
  await dialog
    .getByRole('button', { name: copy('activity.edit.close'), exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await recorded.getByText('Recovered remote title', { exact: true }).waitFor();
  assert.deepEqual(errors, [], 'No runtime errors in migrated surface');
  await writeFile(
    join(output, 'review.json'),
    JSON.stringify(
      {
        passed: true,
        browser: await browser.version(),
        previews,
        writes,
        checks: [
          'keyboard focus containment/restoration',
          'menu membership/disabled state and denied-edit/read-refresh permission parity',
          '44px map/menu/dismiss targets',
          'landscape/tablet/Split View/200% text/RTL preview',
          'Combine and sport filter non-color/mixed state',
          'pending single submission and dismissal guard',
          'one-character name/empty-description committed response',
          'opening draft baseline survives background library prop updates',
          'request/retry error facts and draft retention',
          'partial photos, repeated local cache retry with named44px actions and no remote resubmission, upstream-success recovery',
        ],
        assistiveTechnology:
          'DOM accessibility roles and keyboard only; VoiceOver not exercised',
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS focused activity accessibility and mutation browser review',
  );
} catch (error) {
  failure = error;
  throw error;
} finally {
  await evidence?.finish(failure);
  await browser?.close();
  await cleanupBrowserFixture(root, 'accessibility');
}
