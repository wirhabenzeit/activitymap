import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'node:test';

import { downloadExtract } from './extract-download';

const URL_LATEST =
  'https://download.geofabrik.de/europe/alpland-latest.osm.pbf';
const URL_DATED = 'https://download.geofabrik.de/europe/alpland-261122.osm.pbf';
const content = Buffer.from(
  Array.from({ length: 1000 }, (_, index) => index % 251),
);
const limits = { retryMs: 1, stallMs: 200 };

type Call = { url: string; range: string | null; ifRange: string | null };

/** A body that sends `bytes` and then ends, breaks or stops answering. */
function body(
  bytes: Buffer,
  end: 'close' | 'error' | 'hang',
  signal?: AbortSignal,
) {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    // The bytes are read before the connection ends: an errored stream
    // drops what it still holds.
    pull(controller) {
      if (!sent) {
        sent = true;
        if (bytes.length > 0) return controller.enqueue(new Uint8Array(bytes));
      }
      if (end === 'close') controller.close();
      else if (end === 'error') controller.error(new Error('socket reset'));
      else
        return new Promise<void>((_, reject) =>
          signal?.addEventListener('abort', () =>
            reject(signal.reason as Error),
          ),
        );
    },
  });
}

/** Serves `file` at the dated URL; each connection sends at most the next
 * entry of `cuts` bytes and ends as that entry says. */
function server(
  file: Buffer,
  cuts: { bytes: number; end: 'close' | 'error' | 'hang' }[],
  etag = '"one"',
) {
  const calls: Call[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    const range = headers.get('range');
    calls.push({ url, range, ifRange: headers.get('if-range') });
    if (url === URL_LATEST)
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: URL_DATED } }),
      );
    const cut = cuts.shift() ?? { bytes: Infinity, end: 'close' as const };
    const from = range ? Number(/^bytes=(\d+)-$/.exec(range)![1]) : 0;
    const part = file.subarray(from, from + cut.bytes);
    const end = from + part.length === file.length ? 'close' : cut.end;
    return Promise.resolve(
      new Response(body(part, end, init?.signal ?? undefined), {
        status: range ? 206 : 200,
        headers: {
          etag,
          'content-length': String(file.length - from),
          ...(range
            ? {
                'content-range': `bytes ${from}-${file.length - 1}/${file.length}`,
              }
            : {}),
        },
      }),
    );
  }) as typeof fetch;
  return { calls, fetcher };
}

async function inDirectory(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'extract-download-'));
  try {
    await run(join(directory, 'source.osm.pbf'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test('a download that drops, closes early and stalls is resumed', () =>
  inDirectory(async (path) => {
    const { calls, fetcher } = server(content, [
      { bytes: 300, end: 'error' },
      { bytes: 200, end: 'close' },
      { bytes: 100, end: 'hang' },
    ]);
    const messages: string[] = [];
    const written = await downloadExtract(URL_LATEST, path, {
      fetcher,
      limits,
      onProgress: (message) => messages.push(message),
    });
    assert.equal(written, content.length);
    assert.deepEqual(await readFile(path), content);
    // The redirect is followed once; resumptions ask the dated file.
    assert.deepEqual(calls, [
      { url: URL_LATEST, range: null, ifRange: null },
      { url: URL_DATED, range: null, ifRange: null },
      { url: URL_DATED, range: 'bytes=300-', ifRange: '"one"' },
      { url: URL_DATED, range: 'bytes=500-', ifRange: '"one"' },
      { url: URL_DATED, range: 'bytes=600-', ifRange: '"one"' },
    ]);
    assert.equal(messages.length, 3);
  }));

void test('a file that changed is downloaded again from its start', () =>
  inDirectory(async (path) => {
    const changed = Buffer.from(content).reverse();
    const first = server(content, [{ bytes: 300, end: 'error' }]);
    const second = server(changed, [], '"two"');
    let connections = 0;
    const fetcher = ((input: string | URL | Request, init?: RequestInit) =>
      connections++ === 0
        ? first.fetcher(input, init)
        : // The server ignores a range whose `If-Range` no longer matches.
          second.fetcher(input, { ...init, headers: {} })) as typeof fetch;
    await downloadExtract(URL_DATED, path, { fetcher, limits });
    assert.deepEqual(await readFile(path), changed);
  }));

void test('connections that add nothing end the download', () =>
  inDirectory(async (path) => {
    const { calls, fetcher } = server(
      content,
      Array.from({ length: 10 }, () => ({ bytes: 0, end: 'error' as const })),
    );
    await assert.rejects(
      downloadExtract(URL_DATED, path, {
        fetcher,
        limits: { ...limits, attemptsWithoutProgress: 3 },
      }),
      /failed 3 times in a row/,
    );
    assert.equal(calls.length, 3);
  }));

void test('the overall limit ends a slow download', () =>
  inDirectory(async (path) => {
    const { fetcher } = server(
      content,
      Array.from({ length: 1000 }, () => ({ bytes: 1, end: 'hang' as const })),
    );
    await assert.rejects(
      downloadExtract(URL_DATED, path, {
        fetcher,
        limits: { retryMs: 1, stallMs: 20, totalMs: 100 },
      }),
      /exceeded/,
    );
  }));

void test('answers another connection cannot change fail at once', () =>
  inDirectory(async (path) => {
    let calls = 0;
    const answer = (response: Response) =>
      (() => {
        calls++;
        return Promise.resolve(response);
      }) as typeof fetch;
    await assert.rejects(
      downloadExtract(URL_DATED, path, {
        fetcher: answer(new Response(null, { status: 404 })),
        limits,
      }),
      /Download failed \(404\)/,
    );
    await rm(path);
    await assert.rejects(
      downloadExtract(URL_LATEST, path, {
        fetcher: answer(
          new Response(null, {
            status: 302,
            headers: { location: 'https://mirror.example/alpland.osm.pbf' },
          }),
        ),
        limits,
      }),
      /redirected to a mirror/,
    );
    assert.equal(calls, 2);
    await rm(path);
    await assert.rejects(
      downloadExtract('http://download.geofabrik.de/a.osm.pbf', path, {
        limits,
      }),
      /HTTPS download.geofabrik.de/,
    );
    // An existing file is never overwritten.
    await rm(path);
    await writeFile(path, 'kept');
    await assert.rejects(downloadExtract(URL_DATED, path, { limits }), {
      code: 'EEXIST',
    });
  }));
