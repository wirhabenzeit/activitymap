// Isolated composed proof; intentionally independent of the unmerged quality PR.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { constants, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareLibraryFixture } from './verify-library-owner.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(
  process.env.LIBRARY_OWNER_OUTPUT ||
    join(
      root,
      'output/library-owner',
      new Date().toISOString().replaceAll(':', '-'),
    ),
);
const abort = new AbortController();
const interrupt = () => {
  process.exitCode = 130;
  abort.abort();
};
const terminate = () => {
  process.exitCode = 143;
  abort.abort();
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', terminate);
const summary = {
  passed: false,
  runId: randomUUID(),
  startedAt: new Date().toISOString(),
};
let directory, server, proof;

function command(args, log, env, timeoutMs, echo = false) {
  const stream = createWriteStream(join(output, log));
  const child = spawn(process.execPath, args, {
    cwd: directory,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cleanup,
    timedOut = false;
  const stop = () => {
    if (cleanup || !child.pid) return cleanup;
    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal);
        return true;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        return false;
      }
    };
    if (!kill('SIGTERM')) return;
    // Parent exit does not prove closed-stdio workers exited. Await group escalation.
    cleanup = delay(5000).then(() => {
      kill('SIGKILL');
    });
    return cleanup;
  };
  const receive = (data) => {
    stream.write(data);
    if (echo) process.stdout.write(data);
  };
  child.stdout.on('data', receive);
  child.stderr.on('data', receive);
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  abort.signal.addEventListener('abort', stop, { once: true });
  if (abort.signal.aborted) stop();
  const done = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: 1, error: error.message }));
    child.once('close', (code, signal) =>
      resolve({
        code: timedOut ? 124 : (code ?? 128 + (constants.signals[signal] ?? 1)),
        signal,
        timedOut,
      }),
    );
  }).finally(async () => {
    clearTimeout(timer);
    abort.signal.removeEventListener('abort', stop);
    await cleanup;
    await new Promise((resolve) => stream.end(resolve));
  });
  return { child, done, stop };
}

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function environment(base) {
  const allowed = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'PLAYWRIGHT_BROWSERS_PATH',
    'CHROME_PATH',
  ];
  return {
    ...Object.fromEntries(
      allowed
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    ),
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    CI: '1',
    TZ: 'Europe/Zurich',
    AUTH_SECRET: 'library-owner-isolated-fixture-secret',
    BETTER_AUTH_SECRET: 'library-owner-isolated-fixture-secret',
    DATABASE_URL:
      'postgres://fixture:fixture@127.0.0.1:1/library_owner_fixture',
    NEON_DATABASE_URL:
      'postgres://fixture:fixture@127.0.0.1:1/library_owner_fixture',
    NEON_DATABASE_URL_UNPOOLED:
      'postgres://fixture:fixture@127.0.0.1:1/library_owner_fixture',
    ACTIVITYMAP_EXTERNAL_EFFECTS: '',
    NEXT_PUBLIC_ENV: 'development',
    NEXT_PUBLIC_MAPBOX_TOKEN: 'pk.offline-fixture',
    PUBLIC_URL: base,
    LIBRARY_OWNER_PREPARED: '1',
    LIBRARY_OWNER_RUN_ID: summary.runId,
  };
}

try {
  await mkdir(output, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), 'activitymap-library-owner-'));
  summary.workspace = directory;
  // No dotenv files, credentials, build outputs, or production routes are copied.
  for (const entry of [
    'src',
    'shared',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'postcss.config.js',
  ]) {
    await cp(join(root, entry), join(directory, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  await rm(join(directory, 'src/app'), { recursive: true, force: true });
  await mkdir(join(directory, 'src/app'), { recursive: true });
  await mkdir(join(directory, 'scripts'));
  await cp(
    join(root, 'scripts/verify-library-owner.mjs'),
    join(directory, 'scripts/verify-library-owner.mjs'),
  );
  await symlink(
    await realpath(join(root, 'node_modules')),
    join(directory, 'node_modules'),
    'dir',
  );
  await mkdir(join(directory, 'public'));
  await prepareLibraryFixture(directory); // Exists before Next discovers routes.
  await writeFile(
    join(directory, 'src/app/layout.tsx'),
    `import '~/styles/globals.css';\nimport { ThemeProvider } from '~/components/theme-provider';\nexport default function Layout({children}: {children: React.ReactNode}) { return <html lang="en" suppressHydrationWarning><body><ThemeProvider attribute="class" defaultTheme="light">{children}</ThemeProvider></body></html>; }\n`,
  );
  const base = `http://127.0.0.1:${await freePort()}`;
  const marker = randomUUID();
  await writeFile(join(directory, `public/${marker}.txt`), marker, {
    flag: 'wx',
  });
  await writeFile(
    join(directory, 'next.config.mjs'),
    `export default { reactStrictMode: true, onDemandEntries: { maxInactiveAge: 3600000, pagesBufferLength: 5 }, outputFileTracingRoot: process.cwd(), allowedDevOrigins: ['127.0.0.1'], experimental: {serverActions: {allowedOrigins: [${JSON.stringify(new URL(base).host)}]}} };\n`,
  );
  const env = environment(base);
  const require = createRequire(join(root, 'package.json'));
  server = command(
    [
      require.resolve('next/dist/bin/next'),
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      new URL(base).port,
    ],
    'server.log',
    env,
    8 * 60 * 1000,
  );
  const ownedReady = async () => {
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]);
    while (true) {
      signal.throwIfAborted();
      try {
        const response = await fetch(`${base}/${marker}.txt`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
        });
        if (response.ok && (await response.text()) === marker) return;
      } catch {
        signal.throwIfAborted();
      }
      await delay(100, undefined, { signal });
    }
  };
  await Promise.race([
    ownedReady(),
    server.done.then((result) => {
      throw new Error(
        `Owned Next server exited before readiness: ${JSON.stringify(result)}`,
      );
    }),
  ]);
  const compileStarted = Date.now();
  const response = await fetch(`${base}/library-owner-test`, {
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]),
  });
  await response.arrayBuffer();
  assert(
    response.ok,
    `Fixture compilation failed (${response.status}); see server.log`,
  );
  summary.compileMs = Date.now() - compileStarted;
  console.log(
    `Library fixture compiled in ${summary.compileMs}ms; starting bounded browser assertions.`,
  );
  proof = command(
    [join(directory, 'scripts/verify-library-owner.mjs'), base, output],
    'browser.log',
    env,
    210000,
    true,
  );
  const result = await proof.done;
  assert.equal(
    result.code,
    0,
    `Browser proof failed (${JSON.stringify(result)}); see ${output}`,
  );
  const evidence = JSON.parse(
    await readFile(join(output, 'result.json'), 'utf8'),
  );
  assert.equal(
    evidence.runId,
    summary.runId,
    'Browser evidence must belong to this invocation',
  );
  assert.equal(evidence.passed, true, 'Browser assertions did not pass');
  assert.equal(
    evidence.results.length,
    3,
    'All three composed scenarios must execute',
  );
  assert(
    evidence.results.every(
      (item) => Number.isInteger(item.requests) && item.requests > 0,
    ),
    'Every scenario must execute real mocked sync requests',
  );
  summary.results = evidence.results;
  summary.passed = true;
} catch (error) {
  summary.error = error.stack ?? String(error);
  console.error(error);
  process.exitCode ||= 1;
} finally {
  abort.abort();
  await Promise.allSettled([
    proof?.stop(),
    server?.stop(),
    proof?.done,
    server?.done,
  ]);
  if (directory) await rm(directory, { recursive: true, force: true });
  summary.finishedAt = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, 'runner-summary.json'),
    JSON.stringify(summary, null, 2),
  );
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  console.log(`Library owner evidence: ${output}`);
}
