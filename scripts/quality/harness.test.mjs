import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import test from 'node:test';

import {
  fixtureEnvironment,
  prepareFixtureWorkspace,
  runBrowserHarness,
  waitForOwnedServer,
} from './browser-harness.mjs';
import { waitForFixtureRoute } from './browser-support.mjs';
import {
  validateNativeSuites,
  validateNativeSummary,
} from './native-harness.mjs';
import { runCommand, startCommand } from './process.mjs';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'activitymap-quality-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('fixture startup drops inherited service credentials and uses an inert database', () => {
  const environment = fixtureEnvironment(
    {
      PATH: '/tools',
      HOME: '/user',
      NODE_OPTIONS: '--import=/unsafe',
      DATABASE_URL: 'postgres://real/db',
      NEON_DATABASE_URL: 'postgres://real/neon',
      ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
      VERCEL_ENV: 'production',
      AUTH_STRAVA_SECRET: 'secret',
      NEXT_PUBLIC_MAPBOX_TOKEN: 'real',
    },
    'http://127.0.0.1:4321',
  );
  assert.equal(environment.PATH, '/tools');
  assert.equal(environment.VERCEL_ENV, undefined);
  assert.equal(environment.AUTH_STRAVA_SECRET, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.ACTIVITYMAP_EXTERNAL_EFFECTS, '');
  assert.equal(new URL(environment.DATABASE_URL).host, '127.0.0.1:1');
  assert.equal(environment.NEON_DATABASE_URL, environment.DATABASE_URL);
  assert.equal(environment.PUBLIC_URL, 'http://127.0.0.1:4321');
});

test('temporary workspace excludes local secrets and preserves preexisting source fixtures', async (t) => {
  const parent = await temporary(t);
  const root = join(parent, 'source'),
    destination = join(parent, 'copy');
  for (const directory of [
    'src/app/list-inspection-test',
    'shared',
    'public',
    'node_modules',
    'scripts/quality',
    'ios/ActivityMap/ActivityMapTests/Gallery',
  ])
    await mkdir(join(root, directory), { recursive: true });
  await mkdir(destination);
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'next.config.js',
    'postcss.config.js',
    'scripts/verify-list-inspection.mjs',
    'scripts/verify-stats-focus.mjs',
    'scripts/verify-account-deletion.mjs',
    'scripts/quality/browser-support.mjs',
    'ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json',
  ])
    await writeFile(join(root, file), '{}');
  await writeFile(join(root, '.env.local'), 'DATABASE_URL=production');
  await writeFile(
    join(root, 'src/app/list-inspection-test/page.tsx'),
    'owned by developer',
  );
  await prepareFixtureWorkspace(root, destination);
  await assert.rejects(access(join(destination, '.env.local')));
  await assert.rejects(
    mkdir(join(destination, 'src/app/list-inspection-test')),
    { code: 'EEXIST' },
  );
  await rm(destination, { recursive: true, force: true });
  assert.equal(
    await readFile(join(root, 'src/app/list-inspection-test/page.tsx'), 'utf8'),
    'owned by developer',
  );
});

test('readiness rejects an unrelated server even when it returns HTTP 200', async (t) => {
  const server = createServer((_, response) => response.end('some other app'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    waitForOwnedServer(
      { child: { exitCode: null, signalCode: null } },
      `http://127.0.0.1:${server.address().port}`,
      'unique-proof',
      new AbortController().signal,
      50,
    ),
    /did not become ready/,
  );
});

test('subprocess failures retain exit status and write actionable logs', async (t) => {
  const directory = await temporary(t);
  const log = join(directory, 'child.log');
  await assert.rejects(
    runCommand(
      process.execPath,
      ['-e', 'console.error("fixture failed");process.exit(7)'],
      { log, echo: false },
    ),
    { exitCode: 7 },
  );
  assert.match(await readFile(log, 'utf8'), /fixture failed/);
});

test('timeouts stop the owned child and retain a distinct failure status', async () => {
  const command = startCommand(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    { timeoutMs: 50, echo: false },
  );
  const result = await command.done;
  assert.equal(result.exitCode, 124);
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGTERM');
});

test('missing executables reject without cleanup trying to kill an absent PID', async () => {
  const command = startCommand(
    '/activitymap-quality-command-does-not-exist',
    [],
    { timeoutMs: 50, echo: false },
  );
  await assert.rejects(command.done, { code: 'ENOENT' });
  assert.doesNotThrow(() => command.stop());
});

test('native results reject zero executed, skipped, or failed tests', () => {
  const summary = {
    passedTests: 18,
    failedTests: 0,
    skippedTests: 0,
    result: 'Passed',
  };
  validateNativeSummary(summary);
  assert.throws(
    () => validateNativeSummary({ ...summary, passedTests: 0 }),
    /no passing tests/,
  );
  assert.throws(
    () => validateNativeSummary({ ...summary, skippedTests: 1 }),
    /skip/,
  );
  assert.throws(
    () => validateNativeSummary({ ...summary, failedTests: 1 }),
    /failures/,
  );
});

// Exercise the real ownership/finally boundary before a browser or server exists.
test('early startup failure cleans its workspace and still writes evidence', async (t) => {
  const root = await temporary(t);
  const output = join(root, 'evidence');
  await assert.rejects(
    runBrowserHarness({ root, output, suites: ['account'] }),
    { code: 'ENOENT' },
  );
  assert.deepEqual(await readdir(join(root, '.quality')), []);
  const summary = JSON.parse(
    await readFile(join(output, 'summary.json'), 'utf8'),
  );
  assert.equal(summary.passed, false);
  assert.match(summary.error, /ENOENT/);
  assert(summary.finishedAt);
});

test('native suite validation rejects a selected suite with zero runtime cases', () => {
  const tree = {
    testNodes: [
      {
        nodeType: 'Test Suite',
        name: 'ExampleTests',
        children: [
          { nodeType: 'Test Case', name: 'example()', result: 'Passed' },
        ],
      },
    ],
  };
  assert.deepEqual(validateNativeSuites(tree, ['Target/ExampleTests']), {
    'Target/ExampleTests': 1,
  });
  assert.throws(
    () => validateNativeSuites(tree, ['Target/OtherTests']),
    /Missing executed/,
  );
  tree.testNodes[0].children[0].result = 'Skipped';
  assert.throws(
    () => validateNativeSuites(tree, ['Target/ExampleTests']),
    /Non-passing/,
  );
});

test('fixture readiness waits for discovery but does not hide compilation failures', async (t) => {
  let status = 404;
  const server = createServer((_, response) => {
    response.writeHead(status);
    response.end('fixture');
    status = 200;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/fixture`;
  await waitForFixtureRoute(url, 1000);
  status = 500;
  await assert.rejects(
    waitForFixtureRoute(url, 1000),
    /Fixture route failed \(500\)/,
  );
});

test(
  'timeout cleanup waits for TERM-ignoring descendants after their parent exits',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await temporary(t);
    const pidFile = join(root, 'worker.pid');
    const worker = `process.on('SIGTERM', () => {});require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setInterval(() => {}, 1000);`;
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], {stdio:'ignore'});setInterval(() => {}, 1000);`;
    const command = startCommand(process.execPath, ['-e', parent], {
      timeoutMs: 1000,
      echo: false,
    });
    const result = await command.done;
    const pid = Number(await readFile(pidFile, 'utf8'));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        return false;
      }
    };
    t.after(() => {
      if (alive()) process.kill(pid, 'SIGKILL');
    });
    for (let attempt = 0; alive() && attempt < 20; attempt++) await delay(100);
    assert.equal(result.exitCode, 124);
    assert.equal(
      alive(),
      false,
      'owned descendant survived bounded process-group cleanup',
    );
  },
);
