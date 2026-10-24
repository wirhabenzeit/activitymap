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
  browserFixtures,
  cleanupBrowserFixture,
  createBrowserFixture,
  prepareBrowserFixture,
} from './browser-fixtures.mjs';
import {
  browserSuites,
  fixtureEnvironment,
  prepareFixtureWorkspace,
  runBrowserHarness,
  waitForOwnedServer,
} from './browser-harness.mjs';
import { waitForFixtureRoute } from './browser-support.mjs';
import {
  nativePRUISelectors,
  nativeSuiteEligibility,
  nativeSuites,
  nativeTestProfile,
  selectNativeSimulator,
  validateNativeSuites,
  validateNativeSummary,
} from './native-harness.mjs';
import { runCommand, startCommand } from './process.mjs';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'activitymap-quality-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('native runtime eligibility reports iOS 27 sheet and content Back coverage while retaining iOS 26 calendar regressions', () => {
  const older = nativeSuiteEligibility('26.2');
  assert.deepEqual(older.ineligibleSuites, [
    {
      suite: 'ActivityMapUITests/MapRotationUITests',
      requires: 'iOS 27+',
      actual: '26.2',
      reason: 'Retained native-sheet rotation contract',
    },
    {
      suite: 'ActivityMapUITests/ActivityContinuationUITests',
      requires: 'iOS 27+',
      actual: '26.2',
      reason: 'Retained native-sheet continuation fixture',
    },
    {
      suite: 'ActivityMapTests/DetailBackGestureTests',
      requires: 'iOS 27+',
      actual: '26.2',
      reason: 'Native content-pop recognizer delegate contract',
    },
    {
      suite: 'ActivityMapUITests/StatsUITests',
      requires: 'iOS 27+',
      actual: '26.2',
      reason: 'Stats calendar pan and native content Back contract',
    },
  ]);
  assert.equal(older.suites.length, nativeSuites.length - 4);
  assert(older.suites.includes('ActivityMapTests/StatsCalendarLayoutTests'));
  assert(
    older.suites.includes('ActivityMapTests/StatsCalendarScrollRenderingTests'),
  );
  assert(!older.suites.includes('ActivityMapTests/DetailBackGestureTests'));
  assert(!older.suites.includes('ActivityMapUITests/StatsUITests'));
  assert(older.suites.includes('ActivityMapUITests/MapPhotoUITests'));
  assert(!older.suites.includes('ActivityMapUITests/MapRotationUITests'));
  assert(
    !older.suites.includes('ActivityMapUITests/ActivityContinuationUITests'),
  );
  assert(older.suites.includes('ActivityMapTests/ActivityContinuationTests'));
  assert.deepEqual(nativeSuiteEligibility('27.0.1'), {
    suites: nativeSuites,
    ineligibleSuites: [],
  });
  assert.throws(() => nativeSuiteEligibility('25.0'), /iOS 26/);
  assert.throws(() => nativeSuiteEligibility('unknown'), /iOS 26/);
});

test('native profiles retain all unit suites and select exactly the intended PR UI journeys', () => {
  const pr = nativeTestProfile('pr');
  const full = nativeTestProfile();
  const unitSuites = nativeSuites.filter((suite) =>
    suite.startsWith('ActivityMapTests/'),
  );
  const expectedUI = [
    'ActivityMapUITests/ActivityPlacesUITests/testOfflineMapProfileStyleAndSelection',
    'ActivityMapUITests/ActivityActionUITests/testGPXSharePresentsNativelyAndCleansUpRepeatedCancellationAndDeparture',
    'ActivityMapUITests/ActivityContinuationUITests/testListTopPullOpensPrevious',
    'ActivityMapUITests/ActivityContinuationUITests/testMapBottomPullAdvancesOnceAndReturnsToTop',
    'ActivityMapUITests/StatsUITests/testCalendarRetainsIntentionalContentAndNativeEdgeBack',
    'ActivityMapUITests/StatsUITests/testCompactSportMixRequiresExplicitExpansionAndFocusedSettingsRemainReachable',
  ];
  assert.equal(unitSuites.length, 31);
  assert.deepEqual(nativePRUISelectors, expectedUI);
  assert.deepEqual(pr.suites, [...unitSuites, ...expectedUI]);
  assert.equal(new Set(pr.suites).size, 37);
  assert.equal(pr.name, 'pr');
  assert.equal(pr.runtimeTimeoutMs, 12 * 60 * 1000);
  assert.deepEqual(full.suites, nativeSuites);
  assert.equal(full.suites.length, 38);
  assert.equal(full.name, 'full');
  assert.equal(full.runtimeTimeoutMs, 45 * 60 * 1000);
  assert.deepEqual(nativeTestProfile('full'), full);
  for (const name of ['smoke', '', 'FULL', 'unknown'])
    assert.throws(() => nativeTestProfile(name), /Unknown IOS_TEST_PROFILE/);
  assert.throws(
    () => nativeSuiteEligibility('27.0', 'unknown'),
    /Unknown IOS_TEST_PROFILE/,
  );
});

test('native PR eligibility names excluded methods precisely and retains ordinary iOS 26 regressions', () => {
  const result = nativeSuiteEligibility('26.2', 'pr');
  const excluded = [
    ...nativePRUISelectors.filter((selector) =>
      selector.includes('/ActivityContinuationUITests/'),
    ),
    'ActivityMapTests/DetailBackGestureTests',
    ...nativePRUISelectors.filter((selector) =>
      selector.includes('/StatsUITests/'),
    ),
  ];
  assert.deepEqual(
    result.ineligibleSuites.map((item) => item.suite),
    excluded,
  );
  assert(
    result.ineligibleSuites.every(
      (item) => item.actual === '26.2' && item.requires === 'iOS 27+',
    ),
  );
  assert.equal(result.suites.length, 32);
  assert(
    result.suites.includes(
      'ActivityMapTests/StatsCalendarScrollRenderingTests',
    ),
  );
  assert(result.suites.includes('ActivityMapTests/StatsCalendarLayoutTests'));
  assert.deepEqual(
    result.suites.filter((suite) => suite.startsWith('ActivityMapUITests/')),
    nativePRUISelectors.filter(
      (selector) =>
        selector.includes('/ActivityPlacesUITests/') ||
        selector.includes('/ActivityActionUITests/'),
    ),
  );
  assert.deepEqual(nativeSuiteEligibility('27.0', 'pr'), {
    suites: nativeTestProfile('pr').suites,
    ineligibleSuites: [],
  });
});

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
    'scripts/fixtures',
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
    ...Object.values(browserSuites).map((script) => `scripts/${script}`),
    'scripts/fixtures/react-ui-reconciliation.tsx',
    'scripts/quality/browser-support.mjs',
    'scripts/quality/browser-fixtures.mjs',
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
  assert.equal(
    await readFile(
      join(destination, 'scripts/fixtures/react-ui-reconciliation.tsx'),
      'utf8',
    ),
    '{}',
  );
  assert.equal(
    await readFile(join(destination, 'next.config.fixture-base.mjs'), 'utf8'),
    '{}',
  );
  assert.match(
    await readFile(join(destination, 'next.config.js'), 'utf8'),
    /outputFileTracingRoot: import\.meta\.dirname/,
  );
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

test('native exact method validation cannot count a passing sibling or another target', () => {
  const tree = {
    testNodes: [
      {
        nodeType: 'Test Suite',
        name: 'ExampleUITests',
        nodeIdentifierURL: 'test://com.apple.xcode/App/UITests/ExampleUITests',
        children: [
          {
            nodeType: 'Test Case',
            name: 'testSibling()',
            nodeIdentifier: 'ExampleUITests/testSibling()',
            result: 'Passed',
          },
        ],
      },
    ],
  };
  const selector = 'UITests/ExampleUITests/testRequired';
  assert.throws(
    () => validateNativeSuites(tree, [selector]),
    /Missing executed/,
  );
  tree.testNodes[0].children.push({
    nodeType: 'Test Case',
    name: 'testRequired()',
    nodeIdentifier: 'ExampleUITests/testRequired()',
    result: 'Passed',
  });
  assert.deepEqual(validateNativeSuites(tree, [selector]), { [selector]: 1 });
  assert.deepEqual(validateNativeSuites(tree, [`${selector}()`]), {
    [`${selector}()`]: 1,
  });
  assert.deepEqual(validateNativeSuites(tree, ['UITests/ExampleUITests']), {
    'UITests/ExampleUITests': 2,
  });
  for (const result of ['Failed', 'Skipped', 'Expected Failure']) {
    tree.testNodes[0].children[1].result = result;
    assert.throws(() => validateNativeSuites(tree, [selector]), /Non-passing/);
  }
  tree.testNodes[0].children[1].result = 'Passed';
  tree.testNodes[0].nodeIdentifierURL =
    'test://com.apple.xcode/App/OtherTarget/ExampleUITests';
  assert.throws(
    () => validateNativeSuites(tree, [selector]),
    /Missing executed/,
  );
  delete tree.testNodes[0].nodeIdentifierURL;
  tree.testNodes[0].nodeIdentifier = 'OtherTarget/ExampleUITests';
  assert.throws(
    () => validateNativeSuites(tree, [selector]),
    /Missing executed/,
  );
  tree.testNodes[0].nodeIdentifier = 'UITests/ExampleUITests';
  assert.deepEqual(validateNativeSuites(tree, [selector]), { [selector]: 1 });
  tree.testNodes[0].nodeIdentifier = 'ExampleUITests';
  assert.deepEqual(validateNativeSuites(tree, [selector]), { [selector]: 1 });
});

test('native exact method validation supports test names when xcresult omits identifiers', () => {
  const tree = {
    testNodes: [
      {
        nodeType: 'Test Suite',
        name: 'ExampleUITests',
        children: [
          { nodeType: 'Test Case', name: 'testRequired()', result: 'Passed' },
          {
            nodeType: 'Test Case',
            name: 'testRequiredElsewhere()',
            result: 'Passed',
          },
        ],
      },
    ],
  };
  const selector = 'UITests/ExampleUITests/testRequired';
  assert.deepEqual(validateNativeSuites(tree, [selector]), { [selector]: 1 });
  assert.throws(
    () => validateNativeSuites(tree, ['UITests/ExampleUITests/testMissing']),
    /Missing executed/,
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

test('precreated routes require this run owner and unchanged shared source', async (t) => {
  const root = await temporary(t);
  await mkdir(join(root, 'src/app'), { recursive: true });
  const route = await createBrowserFixture(root, 'list', 'owned-run');
  assert.equal(
    await readFile(join(route, 'page.tsx'), 'utf8'),
    browserFixtures.list.source,
  );
  await assert.rejects(createBrowserFixture(root, 'list', 'another-run'), {
    code: 'EEXIST',
  });
  const previous = process.env.QUALITY_FIXTURE_OWNER;
  t.after(() => {
    if (previous === undefined) delete process.env.QUALITY_FIXTURE_OWNER;
    else process.env.QUALITY_FIXTURE_OWNER = previous;
  });
  process.env.QUALITY_FIXTURE_OWNER = 'owned-run';
  assert.equal(await prepareBrowserFixture(root, 'list'), route);
  await cleanupBrowserFixture(root, 'list');
  await access(join(route, 'page.tsx')); // Harness retains routes through all scenarios.
  process.env.QUALITY_FIXTURE_OWNER = 'different-run';
  await assert.rejects(
    prepareBrowserFixture(root, 'list'),
    /not created by this harness/,
  );
  process.env.QUALITY_FIXTURE_OWNER = 'owned-run';
  await writeFile(join(route, 'page.tsx'), 'developer edit');
  await assert.rejects(
    prepareBrowserFixture(root, 'list'),
    /modified prepared fixture/,
  );
  assert.equal(
    await readFile(join(route, 'page.tsx'), 'utf8'),
    'developer edit',
  );
  delete process.env.QUALITY_FIXTURE_OWNER;
  await cleanupBrowserFixture(root, 'list');
  await assert.rejects(access(route));
});

test('cold fixture readiness is cancelled by its harness owner', async (t) => {
  const controller = new AbortController();
  const server = createServer(() =>
    controller.abort(new Error('harness cancelled')),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  await assert.rejects(
    waitForFixtureRoute(
      `http://127.0.0.1:${server.address().port}/fixture`,
      1000,
      controller.signal,
    ),
    /harness cancelled/,
  );
});

test('fixture write failure removes only its newly created partial route', async (t) => {
  const root = await temporary(t);
  await mkdir(join(root, 'src/app'), { recursive: true });
  // A deterministic failed owner-file write after the page has been created.
  await assert.rejects(createBrowserFixture(root, 'list', {}), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
  await assert.rejects(access(join(root, 'src/app/list-inspection-test')));
  const route = await createBrowserFixture(root, 'list', 'retry');
  await writeFile(join(route, 'page.tsx'), 'developer fixture');
  await assert.rejects(createBrowserFixture(root, 'list', 'another'), {
    code: 'EEXIST',
  });
  assert.equal(
    await readFile(join(route, 'page.tsx'), 'utf8'),
    'developer fixture',
  );
});

test('default simulator preserves the phone and selects its newest compatible runtime', () => {
  const oldPhone = {
    name: 'iPhone 17 Pro',
    identifier: 'phone17',
    productFamily: 'iPhone',
  };
  const newPhone = {
    name: 'iPhone Duo',
    identifier: 'phone-duo',
    productFamily: 'iPhone',
  };
  const older = {
    identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
    version: '27.0',
    isAvailable: true,
    supportedDeviceTypes: [oldPhone],
  };
  const newest = {
    identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1',
    version: '27.1',
    isAvailable: true,
    supportedDeviceTypes: [newPhone],
  };
  assert.deepEqual(
    selectNativeSimulator([older, newest], [oldPhone, newPhone]),
    { runtime: older, type: oldPhone },
  );
  assert.deepEqual(
    selectNativeSimulator([older, newest], [oldPhone, newPhone], newPhone.name),
    { runtime: newest, type: newPhone },
  );
  assert.deepEqual(
    selectNativeSimulator([older, newest], [oldPhone, newPhone], oldPhone.name),
    { runtime: older, type: oldPhone },
  );
  assert.deepEqual(selectNativeSimulator([older], [oldPhone, newPhone]), {
    runtime: older,
    type: oldPhone,
  });
});

test('simulator selection ignores unavailable and unsupported platforms and preserves explicit-device errors', () => {
  const phone = {
    name: 'iPhone 17 Pro',
    identifier: 'phone17',
    productFamily: 'iPhone',
  };
  const runtime = {
    identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
    version: '27.0',
    isAvailable: true,
    supportedDeviceTypes: [phone],
  };
  const unavailable = { ...runtime, version: '27.2', isAvailable: false };
  const vision = {
    ...runtime,
    identifier: 'com.apple.CoreSimulator.SimRuntime.xrOS-27-1',
    version: '27.1',
  };
  assert.deepEqual(
    selectNativeSimulator([unavailable, vision, runtime], [phone]),
    { runtime, type: phone },
  );
  assert.throws(
    () => selectNativeSimulator([runtime], [phone], 'Missing phone'),
    /IOS_DEVICE_NAME is unavailable/,
  );
  assert.throws(
    () =>
      selectNativeSimulator(
        [{ ...runtime, supportedDeviceTypes: [] }],
        [phone],
        phone.name,
      ),
    /No available iOS 26\+ runtime supports/,
  );
});

test('simulator selection does not lower the runtime floor or guess compatibility when the inventory is incomplete', () => {
  const phone = {
    name: 'iPhone 17 Pro',
    identifier: 'phone17',
    productFamily: 'iPhone',
  };
  const runtime = {
    identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-25-0',
    version: '25.0',
    isAvailable: true,
    supportedDeviceTypes: [phone],
  };
  assert.throws(() => selectNativeSimulator([runtime], [phone]), /iOS 26\+/);
  assert.throws(
    () =>
      selectNativeSimulator(
        [{ ...runtime, version: '27.1', supportedDeviceTypes: undefined }],
        [phone],
      ),
    /No available iOS 26\+ runtime supports/,
  );
});
