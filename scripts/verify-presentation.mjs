import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  cleanupBrowserFixture,
  prepareBrowserFixture,
} from './quality/browser-fixtures.mjs';
import {
  launchBrowser,
  recordBrowserEvidence,
} from './quality/browser-support.mjs';

const root = resolve(import.meta.dirname, '..');
const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Fixture server must be local',
);
const output = resolve(
  process.argv[3] || '/tmp/activitymap-presentation-browser',
);
const catalog = JSON.parse(
  await readFile(join(root, 'shared/presentation/catalog.v1.json'), 'utf8'),
);
const fixtures = JSON.parse(
  await readFile(join(root, 'shared/presentation/fixtures.v1.json'), 'utf8'),
);
await prepareBrowserFixture(root, 'presentation');
await mkdir(output, { recursive: true });
let browser, evidence, failure;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    locale: 'en-US',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  evidence = await recordBrowserEvidence(context, { base, output });
  let release;
  let payload;
  let requests = 0;
  await context.route('**/api/auth/sign-in/social', async (route) => {
    requests++;
    payload = route.request().postDataJSON();
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'FIXTURE_FAILURE',
        message: 'Synthetic connection failure',
      }),
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('/presentation-test?error=access_denied', base).href);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(
    await page.getByRole('status').textContent(),
    catalog.messages['connect.cancelled'].source,
  );
  const button = page.getByRole('button', {
    name: catalog.messages['connect.button'].source,
  });
  await button.click();
  await page.waitForFunction(
    () => document.querySelector('[aria-busy="true"]') !== null,
  );
  assert.equal(await button.isDisabled(), true);
  await page.waitForTimeout(100);
  assert.equal(requests, 1);
  assert.equal(payload.provider, 'strava');
  assert.equal(payload.callbackURL, '/map');
  assert.equal(payload.errorCallbackURL, '/map');
  release();
  await page.getByRole('alert').waitFor();
  assert.equal(
    await page.getByRole('alert').textContent(),
    catalog.messages['connect.failed'].source,
  );
  assert.equal(await button.isEnabled(), true);
  const previews = [];
  for (const preview of fixtures.previews) {
    await page.setViewportSize({ width: preview.width, height: 1000 });
    // Pseudolocalization is applied only to known app-owned text in this isolated
    // renderer fixture. No target translation or preview mode enters product code.
    await page.evaluate(
      ({ preview, messages }) => {
        document.documentElement.dir = preview.direction;
        document.documentElement.lang = preview.language;
        document.documentElement.style.fontSize = `${16 * preview.textScale}px`;
        const source = Object.values(messages).map((value) => value.source);
        const walker = document.createTreeWalker(
          document.querySelector('[role="dialog"]'),
          NodeFilter.SHOW_TEXT,
        );
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const text = node.textContent;
          if (!source.includes(text)) continue;
          if (preview.expansion > 1)
            node.textContent = `[${text} ${'ëxţëñđëđ '.repeat(Math.ceil((text.length * (preview.expansion - 1)) / 9))}]`;
        }
      },
      { preview, messages: catalog.messages },
    );
    const geometry = await dialog.boundingBox();
    assert(
      geometry &&
        geometry.width <= preview.width &&
        geometry.x >= 0 &&
        geometry.y >= 0,
      'Dialog fits viewport',
    );
    const overflow = await dialog.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    );
    assert.equal(
      overflow,
      false,
      'Expanded message wraps without horizontal overflow',
    );
    await page.screenshot({
      path: join(output, `${preview.id}.png`),
      fullPage: true,
    });
    const permissions = dialog.locator('p').last();
    await permissions.scrollIntoViewIfNeeded();
    const permissionsGeometry = await permissions.boundingBox();
    assert(
      permissionsGeometry &&
        permissionsGeometry.y >= 0 &&
        permissionsGeometry.y + permissionsGeometry.height <= 1000,
      'Permission explanation remains reachable by scrolling',
    );
    await page.screenshot({
      path: join(output, `${preview.id}-end.png`),
      fullPage: true,
    });
    previews.push({ id: preview.id, geometry, overflow, permissionsGeometry });
    // Restore the unmodified production render before the next preview.
    await page.reload();
    await dialog.waitFor();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'verification.json'),
    JSON.stringify({ requests, payload, previews, errors }, null, 2),
  );
  console.log(
    'Strava message/action permission surface: cancellation, pending/disabled, failure recovery, stable callback, English/expanded/RTL rendering passed.',
  );
} catch (error) {
  failure = error;
  throw error;
} finally {
  await evidence?.finish(failure);
  await browser?.close();
  await cleanupBrowserFixture(root, 'presentation');
}
