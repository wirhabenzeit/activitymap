import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { runCommand, startCommand } from './process.mjs';

export const browserSuites = {
  list: 'verify-list-inspection.mjs',
  stats: 'verify-stats-focus.mjs',
  account: 'verify-account-deletion.mjs',
};

export function fixtureEnvironment(inherited, base) {
  const allowed = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SystemRoot',
    'COMSPEC',
    'PLAYWRIGHT_BROWSERS_PATH',
    'CHROME_PATH',
  ];
  return {
    ...Object.fromEntries(
      allowed
        .filter((key) => inherited[key])
        .map((key) => [key, inherited[key]]),
    ),
    CI: '1',
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    AUTH_SECRET: 'browser-fixture-secret-at-least-32-characters',
    BETTER_AUTH_SECRET: 'browser-fixture-secret-at-least-32-characters',
    DATABASE_URL:
      'postgres://fixture:fixture@127.0.0.1:1/activitymap_browser_fixture',
    NEON_DATABASE_URL:
      'postgres://fixture:fixture@127.0.0.1:1/activitymap_browser_fixture',
    NEON_DATABASE_URL_UNPOOLED:
      'postgres://fixture:fixture@127.0.0.1:1/activitymap_browser_fixture',
    ACTIVITYMAP_EXTERNAL_EFFECTS: '',
    NEXT_PUBLIC_MAPBOX_TOKEN: 'pk.browser-fixture-unused',
    NEXT_PUBLIC_ENV: 'development',
    PUBLIC_URL: base,
    TZ: 'Europe/Zurich',
  };
}

export async function prepareFixtureWorkspace(root, directory) {
  // Copy an allowlist, never .env*, .git, Config/Local.xcconfig, or build outputs.
  for (const path of [
    'src',
    'shared',
    'public',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'next.config.js',
    'postcss.config.js',
  ]) {
    await cp(join(root, path), join(directory, path), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
  const fixtures = 'ios/ActivityMap/ActivityMapTests/Gallery';
  await mkdir(join(directory, fixtures), { recursive: true });
  await cp(
    join(root, fixtures, 'gallery-activities.json'),
    join(directory, fixtures, 'gallery-activities.json'),
  );
  await mkdir(join(directory, 'scripts/quality'), { recursive: true });
  for (const script of Object.values(browserSuites))
    await cp(join(root, 'scripts', script), join(directory, 'scripts', script));
  await cp(
    join(root, 'scripts/quality/browser-support.mjs'),
    join(directory, 'scripts/quality/browser-support.mjs'),
  );
  await symlink(
    await realpath(join(root, 'node_modules')),
    join(directory, 'node_modules'),
    'dir',
  );
}

export async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export async function waitForOwnedServer(
  server,
  base,
  marker,
  signal,
  timeoutMs = 120000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    assert(
      server.child.exitCode === null && server.child.signalCode === null,
      'The owned Next server exited before readiness; see server.log',
    );
    try {
      const response = await fetch(`${base}/__quality-ready-${marker}.txt`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
      });
      if (response.ok && (await response.text()) === marker) return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await delay(200, undefined, { signal });
  }
  throw new Error(
    'Owned Next server did not become ready within 120 seconds; see server.log',
  );
}

export async function runBrowserHarness({
  root,
  output,
  suites = Object.keys(browserSuites),
}) {
  assert(
    suites.length > 0 && suites.every((suite) => browserSuites[suite]),
    'Choose list, stats, and/or account',
  );
  await mkdir(output, { recursive: true });
  await mkdir(join(root, '.quality'), { recursive: true });
  const workspace = await mkdtemp(join(root, '.quality/browser-'));
  const abort = new AbortController();
  const onSignal = (signal) => {
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    abort.abort(new Error(`Interrupted by ${signal}`));
  };
  const onInterrupt = () => onSignal('SIGINT');
  const onTerminate = () => onSignal('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const summary = {
    startedAt: new Date().toISOString(),
    suites: [],
    workspace,
    passed: false,
  };
  let server;
  try {
    await prepareFixtureWorkspace(root, workspace);
    const base = `http://127.0.0.1:${await unusedPort()}`;
    const marker = randomUUID();
    await writeFile(
      join(workspace, `public/__quality-ready-${marker}.txt`),
      marker,
      { flag: 'wx' },
    );
    const env = fixtureEnvironment(process.env, base);
    const require = createRequire(join(root, 'package.json'));
    server = startCommand(
      process.execPath,
      [
        require.resolve('next/dist/bin/next'),
        'dev',
        '--webpack',
        '--hostname',
        '127.0.0.1',
        '--port',
        new URL(base).port,
      ],
      {
        cwd: workspace,
        env,
        log: join(output, 'server.log'),
        timeoutMs: 15 * 60 * 1000,
        signal: abort.signal,
        echo: false,
      },
    );
    await Promise.race([
      waitForOwnedServer(server, base, marker, abort.signal),
      server.done.then((result) => {
        const error = new Error(
          `Owned Next server exited before readiness (${result.signal ?? result.code}); see server.log`,
        );
        error.exitCode = result.exitCode || 1;
        throw error;
      }),
    ]);
    console.log(
      `Owned fixture server ready at ${base}; no migrations or external effects.`,
    );
    for (const suite of suites) {
      const directory = join(output, suite);
      await mkdir(directory, { recursive: true });
      const started = Date.now();
      const result = { name: suite, passed: false };
      summary.suites.push(result);
      try {
        await runCommand(
          process.execPath,
          [join(workspace, 'scripts', browserSuites[suite]), base, directory],
          {
            cwd: workspace,
            env,
            log: join(directory, 'test.log'),
            timeoutMs: 4 * 60 * 1000,
            signal: abort.signal,
          },
        );
        result.passed = true;
      } catch (error) {
        result.error = error.message;
        await writeFile(
          join(directory, 'process-failure.txt'),
          error.stack ?? String(error),
        );
        throw error;
      } finally {
        result.durationMs = Date.now() - started;
      }
    }
    summary.passed = true;
  } catch (error) {
    summary.error = error.stack ?? String(error);
    throw error;
  } finally {
    abort.abort();
    await server?.stop();
    await server?.done.catch((error) => {
      summary.serverError = error.message;
    });
    await rm(workspace, { recursive: true, force: true });
    summary.finishedAt = new Date().toISOString();
    await writeFile(
      join(output, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    console.log(`Browser evidence: ${output}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '../..');
  const suites = process.argv.slice(2).filter((arg) => arg !== '--');
  runBrowserHarness({
    root,
    output: resolve(
      process.env.QUALITY_OUTPUT ||
        join(
          root,
          'output/quality/browser',
          new Date().toISOString().replaceAll(':', '-'),
        ),
    ),
    ...(suites.length ? { suites } : {}),
  }).catch((error) => {
    console.error(error);
    process.exitCode ||= error.exitCode ?? 1;
  });
}
