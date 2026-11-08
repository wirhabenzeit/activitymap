import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
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

const base = new URL(process.argv[2] || 'http://127.0.0.1:3017');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Use a local fixture server',
);
const output = resolve(
  process.argv[3] || '/tmp/activitymap-react-ui-reconciliation',
);
const root = resolve(import.meta.dirname, '..');
await prepareBrowserFixture(root, 'reconciliation');
let browser;
let evidence;
let failure;
try {
  await waitForFixtureRoute(new URL('/react-ui-reconciliation-test', base));
  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    reducedMotion: 'reduce',
  });
  evidence = await recordBrowserEvidence(context, { base, output });
  const errors = [];
  const page = await context.newPage();
  page.on('dialog', (prompt) => prompt.accept());
  page.on('pageerror', (error) => errors.push(error.message));
  const load = async () => {
    await page.goto(new URL('/react-ui-reconciliation-test', base).href);
    await page
      .locator('[data-size]')
      .filter({ hasText: '212×92:true' })
      .waitFor();
    await page.addStyleTag({
      content: 'nextjs-portal { display:none !important; }',
    });
  };
  const fits = async (dialog) => {
    await dialog.evaluate((element) =>
      Promise.all(
        element
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    const bounds = await dialog.boundingBox();
    assert(
      bounds &&
        bounds.y >= 15 &&
        bounds.x >= 15 &&
        bounds.y + bounds.height <= page.viewportSize().height - 15,
      `Dialog must fit viewport: ${JSON.stringify(bounds)}`,
    );
    const close = dialog.getByRole('button', { name: /^Close / });
    if (await close.count()) {
      const target = await close.boundingBox();
      assert(
        target && target.width >= 44 && target.height >= 44,
        'Dismissal must have a44px target',
      );
    }
  };
  const popupFits = async (name) => {
    const listbox = page.getByRole('listbox');
    await listbox.evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    const bounds = await listbox.boundingBox();
    const viewport = page.viewportSize();
    assert(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width &&
        bounds.y + bounds.height <= viewport.height,
      `${name} choices must fit the viewport: ${JSON.stringify(bounds)}`,
    );
  };
  await load();
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 390, height: 667 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Open Edit', exact: true }).click();
    let dialog = page.getByRole('dialog', {
      name: 'Edit activity',
      exact: true,
    });
    await fits(dialog);
    const save = dialog.getByRole('button', { name: 'Save changes' });
    assert(await save.isVisible());
    const before = await save.boundingBox();
    await dialog.locator('[data-app-dialog-body]').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    assert.deepEqual(
      await save.boundingBox(),
      before,
      'Edit actions stay fixed while fields scroll',
    );
    // Opening is insufficient: an option can be visible but covered by the dialog.
    const sport = dialog.getByRole('combobox', { name: 'Sport' });
    await sport.click();
    const run = page.getByRole('option', { name: 'Run', exact: true });
    await run.scrollIntoViewIfNeeded();
    await popupFits('Sport');
    assert(
      await run.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
      'Sport choice must be on top of the dialog',
    );
    await run.click();
    assert.equal(await sport.textContent(), 'Run');
    assert(
      await save.isEnabled(),
      'Selecting a new sport changes the actual form',
    );
    await dialog.getByRole('button', { name: 'Close Edit activity' }).click();
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'Open Edit',
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Open Edit', exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
      'Trigger-less Edit restores its external invoker',
    );
    await page
      .getByRole('button', { name: 'Open Settings', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await fits(dialog);
    await dialog.getByRole('tab', { name: 'Display', exact: true }).click();
    assert(
      await dialog
        .getByRole('tabpanel', { name: 'Display', exact: true })
        .isVisible(),
    );
    await dialog.getByRole('button', { name: 'Close Settings' }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    dialog = page.getByRole('dialog');
    await fits(dialog);
    await dialog
      .getByRole('button', { name: 'Create link', exact: true })
      .waitFor();
    const create = await dialog
      .getByRole('button', { name: 'Create link', exact: true })
      .boundingBox();
    assert(
      create && create.y + create.height <= viewport.height - 15,
      'Share action stays reachable',
    );
    const expiry = dialog.getByRole('combobox', { name: 'Expires after' });
    await expiry.click();
    const oneDay = page.getByRole('option', { name: '1 day', exact: true });
    await oneDay.scrollIntoViewIfNeeded();
    await popupFits('Share expiry');
    assert(
      await oneDay.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
      'Share expiry choice must be on top of the dialog',
    );
    await oneDay.click();
    assert.equal(await expiry.textContent(), '1 day');
    await page.screenshot({
      path: join(output, `share-${viewport.width}x${viewport.height}.png`),
    });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.waitForFunction(
      () => document.activeElement?.textContent?.trim() === 'Share',
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Share', exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
      'Dialog returns focus to its trigger',
    );
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  const checkbox = page.getByRole('menuitemcheckbox', {
    name: 'Photos',
  });
  const checked = await checkbox.getAttribute('aria-checked');
  await checkbox.click();
  assert.notEqual(await checkbox.getAttribute('aria-checked'), checked);
  assert(
    await checkbox.isVisible(),
    'Checkbox selection keeps the preference menu open',
  );
  const menu = page.getByRole('menu').first();
  const bounds = await menu.boundingBox();
  assert(
    bounds && bounds.y >= 0 && bounds.y + bounds.height <= 390,
    'Preference menu fits available height',
  );
  await checkbox.focus();
  await page.keyboard.press('Space');
  assert.equal(
    await checkbox.getAttribute('aria-checked'),
    checked,
    'Keyboard changes once and stays open',
  );
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('menu').count(), 0);

  const actions = page.getByRole('region', { name: 'Map action variants' }); // section has no heading but aria-label gives region.
  const mapButtons = actions.getByRole('button', { name: /^Show on map:/ });
  assert.equal(await mapButtons.count(), 2);
  for (const button of await mapButtons.all())
    assert(await button.isDisabled(), 'Both route-less variants disabled');
  await page.getByRole('button', { name: 'Toggle route' }).click();
  for (const button of await mapButtons.all()) {
    assert(await button.isEnabled());
    await button.click();
  }
  assert.equal(
    await page.locator('[data-commands]').textContent(),
    '2',
    'Both variants dispatch once',
  );

  await page.getByRole('button', { name: 'Replace element' }).click();
  await page
    .locator('section[data-measured] [data-size]')
    .filter({ hasText: '212×92:true' })
    .waitFor();
  await page.getByRole('button', { name: 'Resize element' }).click();
  await page
    .locator('[data-size]')
    .filter({ hasText: '332×92:true' })
    .waitFor();
  await page.getByRole('button', { name: 'Hide measurement' }).click();
  await page.getByRole('button', { name: 'Resize element' }).click();
  await page.getByRole('button', { name: 'Hide measurement' }).click();
  await page
    .locator('[data-size]')
    .filter({ hasText: '212×92:true' })
    .waitFor();

  await page
    .getByRole('button', { name: 'Open nested popups', exact: true })
    .click();
  const nestedDialog = page.getByRole('dialog', {
    name: 'Nested popups',
    exact: true,
  });
  await nestedDialog
    .getByRole('button', { name: 'Open dialog popover', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Change from popover', exact: true })
    .click();
  assert.equal(await page.locator('[data-popup-changes]').textContent(), '1');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Change from popover', exact: true })
    .waitFor({ state: 'hidden' });
  assert(
    await nestedDialog.isVisible(),
    'Dismissing a popover leaves its owning dialog open',
  );
  await nestedDialog
    .getByRole('button', { name: 'Open dialog menu', exact: true })
    .click();
  const nestedChoice = page.getByRole('menuitemcheckbox', {
    name: 'Dialog preference',
    exact: true,
  });
  await nestedChoice.click();
  assert.equal(await nestedChoice.getAttribute('aria-checked'), 'true');
  await page
    .getByRole('menuitem', { name: 'More choices', exact: true })
    .hover();
  const subChoice = page.getByRole('menuitemcheckbox', {
    name: 'Nested preference',
    exact: true,
  });
  await subChoice.click();
  assert.equal(await subChoice.getAttribute('aria-checked'), 'false');
  await page.keyboard.press('ArrowLeft');
  await subChoice.waitFor({ state: 'hidden' });
  assert(await nestedChoice.isVisible(), 'ArrowLeft closes only the submenu');
  await page.keyboard.press('Escape');
  await nestedChoice.waitFor({ state: 'hidden' });
  assert(
    await nestedDialog.isVisible(),
    'Dismissing nested menus leaves its owning dialog open',
  );
  await nestedDialog
    .getByRole('button', { name: 'Close nested popups', exact: true })
    .click();
  await page.getByRole('button', { name: 'Open Feature', exact: true }).click();
  const dismiss = page.getByRole('button', {
    name: 'Close map feature details',
  });
  const target = await dismiss.boundingBox();
  assert(target && target.width >= 44 && target.height >= 44);
  await dismiss.click();
  await page.getByRole('button', { name: /View photo 1 of 1/ }).click();
  const closePhoto = page.getByRole('button', { name: 'Close photo viewer' });
  const photoTarget = await closePhoto.boundingBox();
  assert(photoTarget && photoTarget.width >= 44 && photoTarget.height >= 44);
  await closePhoto.click();
  for (const reducedMotion of ['reduce', 'no-preference']) {
    await page.emulateMedia({ reducedMotion });
    await page
      .getByRole('button', { name: 'Dialog actions', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Edit from menu', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    const editDialog = page.getByRole('dialog', {
      name: 'Edit activity',
      exact: true,
    });
    await editDialog.waitFor();
    await page.keyboard.press('Escape');
    await editDialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'Dialog actions',
    );
    assert.equal(
      await page.getByRole('menu', { includeHidden: true }).count(),
      0,
      'Dialog teardown leaves no closed actions menu',
    );
    await page.evaluate(() => {
      document.body.dataset.escapeUnclaimed = 'false';
      window.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape')
            document.body.dataset.escapeUnclaimed = String(
              !event.defaultPrevented,
            );
        },
        { once: true },
      );
    });
    await page.keyboard.press('Escape');
    assert.equal(
      await page.locator('body').getAttribute('data-escape-unclaimed'),
      'true',
      `${reducedMotion}: no stale dismissal layer consumes the next Escape`,
    );
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Open Connect', exact: true }).click();
  await fits(page.getByRole('dialog'));
  await page.keyboard.press('Escape');
  assert.equal(
    await page.getByRole('dialog').count(),
    1,
    'Required onboarding remains nondismissible',
  );
  assert.deepEqual(errors, [], 'No runtime React errors');
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        viewports: 3,
        checks: [
          'dialog bounds/fixed footer/focus',
          'actual Edit sport and Share expiry option hit testing/selection',
          'nested dialog popover/menu/submenu interaction and dismissal',
          'menu-to-Edit focus/Escape handoff with reduced and normal motion',
          'persistent pointer+keyboard checkboxes',
          'available-height menu',
          'map availability+dispatch',
          'replacement+resize+Activity measurement',
          'feature/photo dismissal targets',
          'non-dismissible onboarding',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS React UI reconciliation browser checks');
} catch (error) {
  failure = error;
  throw error;
} finally {
  await evidence?.finish(failure);
  await browser?.close();
  await cleanupBrowserFixture(root, 'reconciliation');
}
