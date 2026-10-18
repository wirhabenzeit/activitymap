import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { chromium } from 'playwright-core';

export function launchBrowser() {
  return chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
}

// Next's dev watcher may need a moment to discover a route created after startup.
// Retry only the discovery 404; a compile/runtime failure must fail the scenario.
export async function waitForFixtureRoute(url, timeoutMs = 120000) {
  const signal = AbortSignal.timeout(timeoutMs);
  while (true) {
    const response = await fetch(url, { signal });
    await response.arrayBuffer();
    if (response.ok) return;
    if (response.status !== 404)
      throw new Error(`Fixture route failed (${response.status}): ${url}`);
    await delay(200, undefined, { signal });
  }
}

// Register before scenario-specific routes: Playwright gives later fixture
// handlers precedence. Unmocked APIs/actions and remote hosts never reach a server.
export async function recordBrowserEvidence(context, { base, output }) {
  await mkdir(output, { recursive: true });
  const events = [];
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  context.on('page', (page) => {
    page.on('console', (message) =>
      events.push({
        type: 'console',
        level: message.type(),
        text: message.text(),
      }),
    );
    page.on('pageerror', (error) =>
      events.push({ type: 'pageerror', text: error.message }),
    );
    page.on('requestfailed', (request) =>
      events.push({
        type: 'requestfailed',
        url: request.url(),
        error: request.failure(),
      }),
    );
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin !== base.origin ||
      url.pathname.startsWith('/api/') ||
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    ) {
      events.push({ type: 'blocked', url: url.href, method: request.method() });
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: '1',
          error: {
            code: 'fixture_unavailable',
            message: 'No fixture response configured',
            retryable: false,
            requestId: 'browser-fixture',
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  let finished = false;
  const finish = async (error) => {
    if (finished) return;
    finished = true;
    if (error) {
      await Promise.allSettled(
        context.pages().map(async (page, index) => {
          await page.screenshot({
            path: join(output, `failure-${index}.png`),
            timeout: 5000,
          });
          await writeFile(
            join(output, `failure-${index}.html`),
            await page.content(),
          );
        }),
      );
      await writeFile(
        join(output, 'failure.txt'),
        error.stack ?? String(error),
      );
    }
    await writeFile(
      join(output, 'browser-events.json'),
      JSON.stringify(events, null, 2),
    );
    await context.tracing
      .stop({ path: join(output, 'trace.zip') })
      .catch(() => undefined);
    for (const [name, handler] of handlers) process.off(name, handler);
  };
  const handlers = ['SIGINT', 'SIGTERM'].map((name) => {
    const handler = async () => {
      await finish(new Error(`Browser verification interrupted by ${name}`));
      await context.browser()?.close();
      process.exit(name === 'SIGINT' ? 130 : 143);
    };
    process.once(name, handler);
    return [name, handler];
  });
  return { finish };
}
