import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommand } from './process.mjs';

export function selectNativeSimulator(runtimes, devicetypes, requestedName) {
  const available = runtimes
    .filter(
      (runtime) =>
        runtime.isAvailable &&
        runtime.identifier.includes('.iOS-') &&
        Number(runtime.version.split('.')[0]) >= 26,
    )
    .sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
  assert(available.length, 'Install an iOS 26+ simulator runtime in Xcode');
  const supports = (runtime, type) =>
    runtime.supportedDeviceTypes?.some(
      (supported) => supported.identifier === type.identifier,
    );
  // Preserve the suite's phone/form-factor contract. Newer runtime bundles can
  // support a different device family only (for example iPhone Duo).
  const deviceName = requestedName ?? 'iPhone 17 Pro';
  const type = devicetypes.find((item) => item.name === deviceName);
  assert(
    type,
    'Requested IOS_DEVICE_NAME is unavailable; inspect xcrun simctl list devicetypes',
  );
  const runtime = available.find((item) => supports(item, type));
  assert(
    runtime,
    'No available iOS 26+ runtime supports IOS_DEVICE_NAME: ' + deviceName,
  );
  return { runtime, type };
}

export const nativeSuites = [
  'ActivityMapTests/AdaptiveInspectionTests',
  'ActivityMapTests/BrowsingReconciliationTests',
  'ActivityMapTests/StatsPresentationPolicyTests',
  'ActivityMapTests/StatsScopeTests',
  'ActivityMapTests/StatsDashboardTests',
  'ActivityMapTests/StatsFixtureTests',
  'ActivityMapTests/StatsCalendarLayoutTests',
  'ActivityMapTests/StatsCalendarScrollRenderingTests',
  'ActivityMapTests/DetailBackGestureTests',
  'ActivityMapTests/APIErrorFactsTests',
  'ActivityMapTests/AuthRecoveryTests',
  'ActivityMapTests/ActivityEditingTests',
  'ActivityMapTests/ActivityRefreshTests',
  'ActivityMapTests/BrowsingPreferencesTests',
  'ActivityMapTests/ActivitySharingTests',
  'ActivityMapTests/SyncControllerTests',
  'ActivityMapTests/NativeSyncTests',
  'ActivityMapTests/IngestionStatusTests',
  'ActivityMapTests/StravaImportTests',
  'ActivityMapTests/StreamsAPITests',
  'ActivityMapTests/ActivityPlacesTests',
  'ActivityMapTests/PlaceLibraryTests',
  'ActivityMapTests/StreamSummaryLoaderTests',
  'ActivityMapTests/StreamSummarySyncTests',
  'ActivityMapTests/SpeedDisplayTests',
  'ActivityMapTests/PresentationTests',
  'ActivityMapTests/DisplayPreferencesTests',
  'ActivityMapTests/StravaConnectTests',
  'ActivityMapTests/ActivityFilterTests',
  'ActivityMapTests/ActivityStoreSelectionTests',
  'ActivityMapTests/SelectionFixtureTests',
  'ActivityMapTests/MapPhotoTests',
  'ActivityMapTests/MapPlaceTests',
  'ActivityMapTests/MapResultsTests',
  'ActivityMapTests/ActivityContinuationTests',
  'ActivityMapTests/PhotoGalleryTests',
  'ActivityMapUITests/ActivityPlacesUITests',
  'ActivityMapUITests/FilterPanelUITests',
  'ActivityMapUITests/ActivityActionUITests',
  'ActivityMapUITests/StatsUITests',
  'ActivityMapUITests/MapPhotoUITests',
  'ActivityMapUITests/MapRotationUITests',
  'ActivityMapUITests/ActivityContinuationUITests',
  'ActivityMapUITests/ListSelectionUITests',
];

// Four fast journeys that each cover a different surface (map and selection,
// list filtering, navigation, native share). The remaining UI journeys run in
// the full profile (see ios-full.yml), which also runs nightly.
export const nativePRUISelectors = [
  'ActivityMapUITests/FilterPanelUITests/testListSearchNarrowsRowsAndBecomesAFilterChip',
  'ActivityMapUITests/ActivityPlacesUITests/testOfflineMapProfileStyleAndSelection',
  'ActivityMapUITests/ActivityActionUITests/testGPXSharePresentsNativelyAndCleansUpRepeatedCancellationAndDeparture',
  'ActivityMapUITests/ActivityContinuationUITests/testListTopPullOpensPrevious',
];

export function nativeTestProfile(name = 'full') {
  assert(['pr', 'full'].includes(name), `Unknown IOS_TEST_PROFILE: ${name}`);
  return {
    name,
    suites:
      name === 'pr'
        ? [
            ...nativeSuites.filter((suite) =>
              suite.startsWith('ActivityMapTests/'),
            ),
            ...nativePRUISelectors,
          ]
        : [...nativeSuites],
    // Keep runtime separate from compilation; every selected UI journey must run.
    // The PR profile is the app-hosted suites plus four UI journeys (about six
    // minutes on a hosted runner); the full profile's twelve-plus UI journeys
    // need far more. Keep individual test deadlines unchanged so hangs still fail.
    runtimeTimeoutMs: (name === 'pr' ? 12 : 45) * 60 * 1000,
  };
}

// Native-sheet and full-content Back contracts below target iOS 27. iOS 26
// retains ordinary map/photo and calendar-scroll regressions. Ineligibility is
// reported for each requested selector, never counted as skipped or passing.
export function nativeSuiteEligibility(runtimeVersion, profile = 'full') {
  const requested = nativeTestProfile(profile).suites;
  const major = Number(runtimeVersion.split('.')[0]);
  assert(
    Number.isInteger(major) && major >= 26,
    'An iOS 26+ runtime is required',
  );
  const restrictions = [
    [
      'ActivityMapUITests/MapRotationUITests',
      'Retained native-sheet rotation contract',
    ],
    [
      'ActivityMapUITests/ActivityContinuationUITests',
      'Retained native-sheet continuation fixture',
    ],
    [
      'ActivityMapTests/DetailBackGestureTests',
      'Native content-pop recognizer delegate contract',
    ],
    [
      'ActivityMapUITests/StatsUITests',
      'Stats calendar pan and native content Back contract',
    ],
  ];
  const ineligibleSuites =
    major < 27
      ? restrictions.flatMap(([restricted, reason]) =>
          requested
            .filter(
              (selector) =>
                selector === restricted ||
                selector.startsWith(`${restricted}/`),
            )
            .map((suite) => ({
              suite,
              requires: 'iOS 27+',
              actual: runtimeVersion,
              reason,
            })),
        )
      : [];
  return {
    suites: requested.filter(
      (suite) => !ineligibleSuites.some((item) => item.suite === suite),
    ),
    ineligibleSuites,
  };
}

export function validateNativeSummary(summary) {
  assert(
    Number.isInteger(summary.passedTests) && summary.passedTests > 0,
    'Native suite executed no passing tests',
  );
  assert.equal(
    summary.failedTests,
    0,
    'Native regression failures; inspect Results.xcresult',
  );
  assert.equal(
    summary.skippedTests,
    0,
    'The bounded native suite must not silently skip tests',
  );
  assert.equal(summary.result, 'Passed', 'Native result bundle did not pass');
}

export function validateNativeSuites(tree, suites = nativeSuites) {
  const flatten = (nodes) =>
    nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  const nodes = flatten(tree.testNodes ?? []);
  const withoutArguments = (value) => value?.replace(/\(\)$/, '');
  return Object.fromEntries(
    suites.map((suite) => {
      const [target, name, method, ...extra] = suite.split('/');
      assert(
        target && name && extra.length === 0 && method !== '',
        `Invalid native test selector: ${suite}`,
      );
      const classSelector = `${target}/${name}`;
      const matchingSuites = nodes.filter((item) => {
        if (item.nodeType !== 'Test Suite') return false;
        if (item.nodeIdentifierURL)
          return item.nodeIdentifierURL.endsWith(`/${classSelector}`);
        if (item.nodeIdentifier?.includes('/'))
          return item.nodeIdentifier === classSelector;
        return item.nodeIdentifier === name || item.name === name;
      });
      const cases = matchingSuites.flatMap((node) =>
        flatten(node.children ?? []).filter((item) => {
          if (item.nodeType !== 'Test Case') return false;
          if (!method) return true;
          const identifier = withoutArguments(item.nodeIdentifier);
          return (
            identifier === `${name}/${withoutArguments(method)}` ||
            identifier === `${classSelector}/${withoutArguments(method)}` ||
            (!identifier &&
              withoutArguments(item.name) === withoutArguments(method))
          );
        }),
      );
      assert(cases.length > 0, `Missing executed runtime cases for ${suite}`);
      assert(
        cases.every((item) => item.result === 'Passed'),
        `Non-passing runtime case in ${suite}`,
      );
      return [suite, cases.length];
    }),
  );
}

// With -retry-tests-on-failure a test that passes on a later repetition is
// reported as Passed; its failed first run stays visible as a Repetition child.
export function retriedNativeTests(tree) {
  const found = [];
  const visit = (node, trail) => {
    const next = node.nodeType === 'Test Suite' ? [...trail, node.name] : trail;
    if (
      node.nodeType === 'Test Case' &&
      node.result === 'Passed' &&
      (node.children ?? []).some(
        (child) => child.nodeType === 'Repetition' && child.result === 'Failed',
      )
    )
      found.push([...next, node.name].join('/'));
    for (const child of node.children ?? []) visit(child, next);
  };
  for (const node of tree.testNodes ?? []) visit(node, []);
  return found;
}

export async function runNativeHarness({
  root,
  output,
  simulator = process.env.IOS_SIMULATOR_UDID,
  profile = process.env.IOS_TEST_PROFILE ?? 'full',
  run = runCommand,
  platform = process.platform,
  buildStatusPath = process.env.GITHUB_OUTPUT,
  bootAttempts = 2,
  bootAttemptTimeoutMs = 330000,
}) {
  const selectedProfile = nativeTestProfile(profile);
  assert.equal(
    platform,
    'darwin',
    'Native runtime checks require macOS and Xcode 27',
  );
  await mkdir(output, { recursive: true });
  const resultBundle = join(output, 'Results.xcresult');
  await assert.rejects(
    access(resultBundle),
    'Refusing to overwrite an existing xcresult; use a fresh QUALITY_OUTPUT',
  );
  const abort = new AbortController();
  const onInterrupt = () => {
    process.exitCode = 130;
    abort.abort();
  };
  const onTerminate = () => {
    process.exitCode = 143;
    abort.abort();
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const command = (args, log, timeoutMs = 60000, signal = abort.signal) =>
    run('xcrun', args, {
      cwd: root,
      signal,
      timeoutMs,
      log: log && join(output, log),
      echo: Boolean(log),
    });
  // Boot runs beside the build and is stopped if the build fails first.
  const bootAbort = new AbortController();
  abort.signal.addEventListener('abort', () => bootAbort.abort(), {
    once: true,
  });
  // A wedged hosted-runner boot is cheaper to retry from a clean device than
  // to wait out. CoreSimulatorService is left alone: the build is using it.
  const resetOwnedSimulator = async () => {
    for (const [args, timeoutMs] of [
      [['simctl', 'shutdown', simulator], 30000],
      [['simctl', 'erase', simulator], 60000],
    ])
      await command(args, undefined, timeoutMs, bootAbort.signal).catch(
        (error) => console.error(`Simulator reset: ${error.message}`),
      );
  };
  let bootOutcome;
  let ownedSimulator = false;
  const manifest = {
    profile: selectedProfile.name,
    runtimeTimeoutMs: selectedProfile.runtimeTimeoutMs,
    suites: selectedProfile.suites,
    startedAt: new Date().toISOString(),
    phases: {},
    passed: false,
  };
  const phase = async (name, work) => {
    const started = performance.now();
    const result = (manifest.phases[name] = { passed: false });
    console.log(`Native ${name} started.`);
    try {
      const value = await work();
      result.passed = true;
      return value;
    } finally {
      result.durationMs = Math.round(performance.now() - started);
      console.log(
        `Native ${name} ${result.passed ? 'passed' : 'failed'} in ${(result.durationMs / 1000).toFixed(1)}s.`,
      );
    }
  };
  try {
    const version = await run('xcodebuild', ['-version'], {
      timeoutMs: 30000,
      echo: false,
    });
    await writeFile(join(output, 'toolchain.txt'), version);
    assert(
      /Xcode (2[7-9]|[3-9]\d)(?:\.|\s)/.test(version),
      'Xcode 27 or newer is required for availability-guarded APIs',
    );
    const { runtimes } = JSON.parse(
      await command(['simctl', 'list', 'runtimes', '--json']),
    );
    if (!simulator) {
      const { devicetypes } = JSON.parse(
        await command(['simctl', 'list', 'devicetypes', '--json']),
      );
      await writeFile(
        join(output, 'simulator-inventory.json'),
        JSON.stringify({ runtimes, devicetypes }, null, 2),
      );
      const { runtime, type } = selectNativeSimulator(
        runtimes,
        devicetypes,
        process.env.IOS_DEVICE_NAME,
      );
      manifest.deviceType = type.identifier;
      simulator = (
        await command(
          [
            'simctl',
            'create',
            `ActivityMapQuality-${randomUUID()}`,
            type.identifier,
            runtime.identifier,
          ],
          'simulator-create.log',
        )
      ).trim();
      ownedSimulator = true;
    }
    manifest.simulator = simulator;
    const devices = JSON.parse(
      await command(['simctl', 'list', 'devices', '--json']),
    );
    const runtimeEntry = Object.entries(devices.devices).find(([, items]) =>
      items.some((item) => item.udid === simulator),
    );
    const device = runtimeEntry?.[1].find((item) => item.udid === simulator);
    assert(device?.isAvailable, 'The requested simulator is unavailable');
    const runtime = runtimes.find(
      (item) => item.identifier === runtimeEntry[0],
    );
    assert(
      runtime?.isAvailable,
      'The requested simulator runtime is unavailable',
    );
    const { suites, ineligibleSuites } = nativeSuiteEligibility(
      runtime.version,
      selectedProfile.name,
    );
    manifest.runtime = {
      identifier: runtime.identifier,
      version: runtime.version,
    };
    manifest.suites = suites;
    manifest.ineligibleSuites = ineligibleSuites;
    for (const item of ineligibleSuites)
      console.log(
        `Not eligible on iOS ${item.actual}: ${item.suite} requires ${item.requires} (${item.reason}).`,
      );
    // The simulator is not needed until tests launch, so boot it while the app
    // builds (a hosted boot takes 2-5 minutes). A boot failure is reported after
    // the build, which still finishes so its cache can be saved for a rerun.
    bootOutcome = phase('boot', async () => {
      for (let attempt = 1; ; attempt++) {
        const suffix = attempt === 1 ? '' : `-${attempt}`;
        try {
          if (attempt > 1 || device.state !== 'Booted')
            await command(
              ['simctl', 'boot', simulator],
              `boot${suffix}.log`,
              120000,
              bootAbort.signal,
            );
          await command(
            ['simctl', 'bootstatus', simulator, '-b'],
            `boot-status${suffix}.log`,
            bootAttemptTimeoutMs,
            bootAbort.signal,
          );
          return;
        } catch (error) {
          // Never touch a simulator the caller owns, and never retry an abort.
          if (
            bootAbort.signal.aborted ||
            !ownedSimulator ||
            attempt >= bootAttempts
          )
            throw error;
          console.error(
            `Simulator boot attempt ${attempt} failed (${error.message}); resetting and retrying.`,
          );
          await resetOwnedSimulator();
        }
      }
    }).then(
      () => null,
      (error) => error,
    );
    const commonArguments = [
      '-project',
      'ios/ActivityMap/ActivityMap.xcodeproj',
      '-scheme',
      'ActivityMap',
      '-configuration',
      'Debug',
      '-destination',
      `platform=iOS Simulator,id=${simulator}`,
      '-destination-timeout',
      '60',
      '-derivedDataPath',
      resolve(
        process.env.IOS_DERIVED_DATA || join(root, '.quality/ios-derived'),
      ),
      ...suites.map((suite) => `-only-testing:${suite}`),
      '-onlyUsePackageVersionsFromResolvedFile',
      '-skipPackageUpdates',
      'ONLY_ACTIVE_ARCH=YES',
      'COMPILER_INDEX_STORE_ENABLE=NO',
      'CODE_SIGNING_ALLOWED=NO',
      'ACTIVITYMAP_API_BASE_URL=http:$(SLASH)$(SLASH)127.0.0.1:1',
    ];
    // The first hosted run spent 11m37s compiling before tests could launch.
    // Give cold compilation its own bound so it cannot consume runtime's budget.
    await phase('build', () =>
      run('xcodebuild', ['build-for-testing', ...commonArguments], {
        cwd: root,
        log: join(output, 'xcodebuild-build.log'),
        timeoutMs: 18 * 60 * 1000,
        signal: abort.signal,
        echo: false,
      }),
    );
    // Preserve a good build cache even when a runtime regression fails later.
    if (buildStatusPath)
      await appendFile(buildStatusPath, 'build_succeeded=true\n');
    const bootError = await bootOutcome;
    if (bootError) throw bootError;
    await phase('test', () =>
      run(
        'xcodebuild',
        [
          'test-without-building',
          ...commonArguments,
          '-resultBundlePath',
          resultBundle,
          '-parallel-testing-enabled',
          'NO',
          // A failing UI journey is rerun once before it fails the job. Passing
          // after a retry is reported below, never silently counted.
          '-retry-tests-on-failure',
          '-test-iterations',
          '2',
          '-test-timeouts-enabled',
          'YES',
          '-default-test-execution-time-allowance',
          '90',
          '-maximum-test-execution-time-allowance',
          '180',
        ],
        {
          cwd: root,
          log: join(output, 'xcodebuild-test.log'),
          // The full matrix has its own runtime budget, separate from cold builds.
          timeoutMs: selectedProfile.runtimeTimeoutMs,
          signal: abort.signal,
          echo: false,
        },
      ),
    );
    const summary = JSON.parse(
      await command([
        'xcresulttool',
        'get',
        'test-results',
        'summary',
        '--path',
        resultBundle,
        '--compact',
      ]),
    );
    await writeFile(
      join(output, 'test-summary.json'),
      JSON.stringify(summary, null, 2),
    );
    validateNativeSummary(summary);
    const tests = await command([
      'xcresulttool',
      'get',
      'test-results',
      'tests',
      '--path',
      resultBundle,
      '--compact',
    ]);
    await writeFile(join(output, 'tests.json'), tests);
    const parsedTests = JSON.parse(tests);
    manifest.executedCasesBySuite = validateNativeSuites(parsedTests, suites);
    manifest.retriedTests = retriedNativeTests(parsedTests);
    for (const name of manifest.retriedTests)
      console.log(
        `::warning title=Flaky iOS test::${name} passed only on retry`,
      );
    manifest.passed = true;
    manifest.passedTests = summary.passedTests;
    console.log(
      `Native ${selectedProfile.name} regression passed: ${summary.passedTests} tests, ${suites.length} selections.`,
    );
  } catch (error) {
    manifest.error = error.stack ?? String(error);
    // Preserve readable failure details even when xcodebuild itself exits nonzero.
    for (const [kind, filename] of [
      ['summary', 'test-summary.json'],
      ['tests', 'tests.json'],
    ]) {
      try {
        const result = await run(
          'xcrun',
          [
            'xcresulttool',
            'get',
            'test-results',
            kind,
            '--path',
            resultBundle,
            '--compact',
          ],
          { timeoutMs: 30000, echo: false },
        );
        await writeFile(join(output, filename), result);
        if (kind === 'summary') {
          for (const failure of JSON.parse(result).testFailures ?? [])
            console.error(
              `${failure.testIdentifierString}: ${failure.failureText}`,
            );
        }
      } catch {
        /* An interrupted build may not have produced a result bundle. */
      }
    }
    throw error;
  } finally {
    const cleanupErrors = [];
    // A failed build leaves the boot running; stop it before deleting the device.
    bootAbort.abort();
    await bootOutcome;
    if (ownedSimulator) {
      // Never shut down or delete a simulator supplied by the caller.
      for (const action of ['shutdown', 'delete']) {
        await run('xcrun', ['simctl', action, simulator], {
          timeoutMs: 30000,
          echo: false,
        }).catch((error) => {
          cleanupErrors.push(error);
          console.error(`Simulator cleanup: ${error.message}`);
        });
      }
    }
    if (cleanupErrors.length) {
      manifest.passed = false;
      manifest.cleanupErrors = cleanupErrors.map((error) => error.message);
    }
    manifest.finishedAt = new Date().toISOString();
    await writeFile(
      join(output, 'summary.json'),
      JSON.stringify(manifest, null, 2),
    );
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    console.log(`Native evidence: ${output}`);
    if (cleanupErrors.length)
      throw new AggregateError(
        cleanupErrors,
        'Owned simulator cleanup failed; see summary.json',
      );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '../..');
  runNativeHarness({
    root,
    output: resolve(
      process.env.QUALITY_OUTPUT ||
        join(
          root,
          'output/quality/ios',
          new Date().toISOString().replaceAll(':', '-'),
        ),
    ),
  }).catch((error) => {
    console.error(error);
    process.exitCode ||= error.exitCode ?? 1;
  });
}
