import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';

import {
  type D1Database,
  type D1Statement,
  appStoreConnectToken,
  ingestTestflightCrashes,
  summarizeCrashLog,
} from './testflight.ts';

/** D1's statement API over node:sqlite, with the real migration applied. */
function memoryD1(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(
      new URL(
        '../migrations/0001_testflight_crash_submissions.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const statement = (query: string, values: unknown[] = []): D1Statement => ({
    bind: (...next) => statement(query, next),
    all: async <T>() => ({
      results: sqlite.prepare(query).all(...(values as SQLInputValue[])) as T[],
    }),
    run: async () => sqlite.prepare(query).run(...(values as SQLInputValue[])),
  });
  return {
    sqlite,
    d1: {
      prepare: (query) => statement(query),
      batch: async (statements) =>
        Promise.all(statements.map((item) => item.run())),
    },
  };
}

async function testKey() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', pair.privateKey),
  );
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

const TEXT_LOG = `Incident Identifier: 1
Exception Type:  EXC_BREAKPOINT (SIGTRAP)
Termination Reason: SIGNAL 5 Trace/BPT trap: 5

Thread 0 name:   Dispatch queue: com.apple.main-thread
Thread 0 Crashed:
0   libswiftCore.dylib            0x00000001a1b2c3d4 _assertionFailure(_:_:file:line:flags:) + 244
1   ActivityMap                   0x0000000100f1e2d3 StatsModel.bucket(for:) + 512 (StatsModel.swift:88)
2   SwiftUI                       0x00000001b2c3d4e5 ViewGraph.update + 40

Thread 1:
0   libsystem_kernel.dylib        0x00000001c0000000 __workq_kernreturn + 8
`;

void test('a text crash log yields its exception and first app frame', () => {
  assert.deepEqual(summarizeCrashLog(TEXT_LOG, 'ActivityMap'), {
    exceptionType: 'EXC_BREAKPOINT (SIGTRAP)',
    crashedFrame:
      'ActivityMap StatsModel.bucket(for:) + 512 (StatsModel.swift:88)',
  });
});

void test('without app symbols, a symbolicated frame is preferred and launch addresses are dropped', () => {
  const log = `Exception Type:  EXC_BREAKPOINT (SIGTRAP)

Thread 20 Crashed:
0   libswiftCore.dylib            \t0x0000000186cb8258 mln::RenderFillLayer::update() + 232 (render_fill_layer.cpp:315)
1   ActivityMap                   \t0x0000000102e4dfa0 0x102934000 + 5349280
`;
  assert.deepEqual(summarizeCrashLog(log, 'ActivityMap'), {
    exceptionType: 'EXC_BREAKPOINT (SIGTRAP)',
    crashedFrame:
      'libswiftCore.dylib mln::RenderFillLayer::update() + 232 (render_fill_layer.cpp:315)',
  });
  const unsymbolicated = log.replace(/^0 .*\n/m, '');
  assert.equal(
    summarizeCrashLog(unsymbolicated, 'ActivityMap').crashedFrame,
    'ActivityMap +5349280',
  );
});

void test('an .ips crash log yields its exception and grouping frame', () => {
  const header = JSON.stringify({ app_name: 'ActivityMap', bug_type: '309' });
  const report = JSON.stringify({
    exception: { type: 'EXC_CRASH', signal: 'SIGABRT' },
    faultingThread: 1,
    usedImages: [{ name: 'libsystem_c.dylib' }, { name: 'ActivityMap' }],
    threads: [
      { frames: [{ imageIndex: 0, symbol: 'idle' }] },
      {
        triggered: true,
        frames: [
          { imageIndex: 0, symbol: 'abort' },
          { imageIndex: 1, imageOffset: 4096 },
        ],
      },
    ],
  });
  assert.deepEqual(summarizeCrashLog(`${header}\n${report}`, 'ActivityMap'), {
    exceptionType: 'EXC_CRASH (SIGABRT)',
    crashedFrame: 'libsystem_c.dylib abort',
  });
});

void test('an unrecognised log is kept without a summary', () => {
  assert.deepEqual(summarizeCrashLog('something else', 'ActivityMap'), {
    exceptionType: null,
    crashedFrame: null,
  });
});

void test('the token is a valid ES256 App Store Connect JWT', async () => {
  const { pem, publicKey } = await testKey();
  const token = await appStoreConnectToken(
    { keyId: 'KEY123', issuerId: 'issuer-uuid', privateKey: pem },
    new Date('2026-11-22T10:00:00Z'),
  );
  const [header, payload, signature] = token.split('.');
  const decode = (part: string) =>
    JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
  assert.deepEqual(decode(header!), {
    alg: 'ES256',
    kid: 'KEY123',
    typ: 'JWT',
  });
  assert.deepEqual(decode(payload!), {
    iss: 'issuer-uuid',
    iat: 1795341590,
    exp: 1795342190,
    aud: 'appstoreconnect-v1',
  });
  assert.ok(
    await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      Buffer.from(signature!, 'base64url'),
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  );
});

function submission(id: string, createdDate: string, buildId = 'build-1') {
  return {
    id,
    type: 'betaFeedbackCrashSubmissions',
    attributes: {
      createdDate,
      comment: `crash ${id}`,
      email: 'tester@example.com',
      deviceModel: 'iPhone17,1',
      osVersion: '27.1',
      appPlatform: 'IOS',
      deviceFamily: 'IPHONE',
      locale: 'en-US',
    },
    relationships: {
      build: { data: { id: buildId, type: 'builds' } },
    },
  };
}

type Route = (url: URL) => Response | undefined;

function fakeApi(routes: Route[]) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    for (const route of routes) {
      const response = route(url);
      if (response) return response;
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function listRoute(pages: Record<string, unknown>): Route {
  return (url) => {
    if (!url.pathname.endsWith('/betaFeedbackCrashSubmissions')) return;
    return json(pages[url.searchParams.get('cursor') ?? 'first']);
  };
}

function logRoute(logs: Record<string, (() => Response) | string>): Route {
  return (url) => {
    const id = /betaFeedbackCrashSubmissions\/([^/]+)\/crashLog$/.exec(
      url.pathname,
    )?.[1];
    if (!id || !(id in logs)) return;
    const log = logs[id]!;
    return typeof log === 'string'
      ? json({
          data: { id, type: 'betaCrashLogs', attributes: { logText: log } },
        })
      : log();
  };
}

async function options(d1: D1Database, fetch: typeof globalThis.fetch) {
  const { pem } = await testKey();
  return {
    db: d1,
    appId: '6819172681',
    credentials: { keyId: 'KEY', issuerId: 'ISS', privateKey: pem },
    fetch,
    now: () => new Date('2026-11-22T10:00:00Z'),
  };
}

void test('new reports are stored with their build and crash log', async () => {
  const { d1, sqlite } = memoryD1();
  const api = fakeApi([
    listRoute({
      first: {
        data: [submission('b', '2026-11-21T09:00:00Z')],
        included: [
          { id: 'build-1', type: 'builds', attributes: { version: '42' } },
        ],
        links: {
          next: 'https://api.appstoreconnect.apple.com/v1/apps/6819172681/betaFeedbackCrashSubmissions?cursor=2',
        },
      },
      '2': { data: [submission('a', '2026-11-20T09:00:00Z')] },
    }),
    logRoute({ a: 'no summary here', b: TEXT_LOG }),
  ]);

  const result = await ingestTestflightCrashes(await options(d1, api.fetch));

  assert.deepEqual(result, {
    listed: 2,
    inserted: 2,
    logsFetched: 2,
    logsFailed: 0,
  });
  const first = new URL(`https://x${api.calls[0]}`);
  assert.equal(
    first.pathname,
    '/v1/apps/6819172681/betaFeedbackCrashSubmissions',
  );
  assert.equal(first.searchParams.get('sort'), '-createdDate');
  assert.equal(first.searchParams.get('include'), 'build');

  const rows = sqlite
    .prepare(
      `SELECT id, created_at, build_number, device_model, comment,
              exception_type, crashed_frame, crash_log IS NOT NULL AS has_log
       FROM crash_submissions ORDER BY created_at DESC`,
    )
    .all();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      {
        id: 'b',
        created_at: '2026-11-21T09:00:00Z',
        build_number: '42',
        device_model: 'iPhone17,1',
        comment: 'crash b',
        exception_type: 'EXC_BREAKPOINT (SIGTRAP)',
        crashed_frame:
          'ActivityMap StatsModel.bucket(for:) + 512 (StatsModel.swift:88)',
        has_log: 1,
      },
      {
        id: 'a',
        created_at: '2026-11-20T09:00:00Z',
        build_number: null,
        device_model: 'iPhone17,1',
        comment: 'crash a',
        exception_type: null,
        crashed_frame: null,
        has_log: 1,
      },
    ],
  );
});

void test('a run stops paging at the first report it already has', async () => {
  const { d1 } = memoryD1();
  const page = (ids: string[]) => ({
    data: ids.map((id) =>
      submission(id, `2026-11-2${ids.indexOf(id)}T00:00:00Z`),
    ),
    links: {
      next: 'https://api.appstoreconnect.apple.com/v1/apps/6819172681/betaFeedbackCrashSubmissions?cursor=older',
    },
  });
  const logs = logRoute({ old: TEXT_LOG, new: TEXT_LOG });

  await ingestTestflightCrashes(
    await options(
      d1,
      fakeApi([
        listRoute({
          first: { data: [submission('old', '2026-11-01T00:00:00Z')] },
        }),
        logs,
      ]).fetch,
    ),
  );
  const second = fakeApi([
    listRoute({ first: page(['new', 'old']), older: page(['ancient']) }),
    logs,
  ]);
  const result = await ingestTestflightCrashes(await options(d1, second.fetch));

  assert.equal(result.inserted, 1);
  assert.equal(result.logsFetched, 1);
  assert.ok(second.calls.every((call) => !call.includes('cursor=older')));
});

void test('a missing crash log is retried on later runs, then given up', async () => {
  const { d1, sqlite } = memoryD1();
  const api = fakeApi([
    listRoute({ first: { data: [submission('x', '2026-11-21T00:00:00Z')] } }),
    logRoute({ x: () => new Response('gone', { status: 404 }) }),
  ]);
  for (let run = 0; run < 7; run++) {
    await ingestTestflightCrashes(await options(d1, api.fetch));
  }
  const logCalls = api.calls.filter((call) => call.endsWith('/crashLog'));
  assert.equal(logCalls.length, 5);
  assert.deepEqual(
    {
      ...sqlite
        .prepare(
          'SELECT crash_log, crash_log_attempts, crash_log_error FROM crash_submissions',
        )
        .get(),
    },
    {
      crash_log: null,
      crash_log_attempts: 5,
      crash_log_error: 'HTTP 404: gone',
    },
  );
});

void test('a failed listing fails the run', async () => {
  const { d1 } = memoryD1();
  const api = fakeApi([
    (url) =>
      url.pathname.endsWith('/betaFeedbackCrashSubmissions')
        ? new Response('{"errors":[{"status":"401"}]}', { status: 401 })
        : undefined,
  ]);
  await assert.rejects(
    ingestTestflightCrashes(await options(d1, api.fetch)),
    /HTTP 401/,
  );
});
