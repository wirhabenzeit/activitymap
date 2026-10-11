import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

type WorkerEvent = {
  request: Request;
  data?: { type: string };
  ports?: Array<{ postMessage: (value: unknown) => void }>;
  waitUntil: (promise: Promise<void>) => void;
  respondWith: (promise: Promise<Response>) => void;
};

function workerFixture() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const deleted: string[] = [];
  let puts = 0;
  let resolveFetch!: (response: Response) => void;
  let rejectFetch!: (error: Error) => void;
  const network = new Promise<Response>((resolve, reject) => {
    resolveFetch = resolve;
    rejectFetch = reject;
  });
  runInNewContext(
    readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'),
    {
      Request,
      Response,
      URL,
      self: {
        location: { origin: 'https://activitymap.cc' },
        addEventListener: (
          name: string,
          handler: (event: WorkerEvent) => void,
        ) => handlers.set(name, handler),
      },
      caches: {
        keys: async () => [
          'activitymap-shell-v3',
          'activitymap-static-v3',
          'activitymap-shell-v2',
          'unrelated',
        ],
        delete: async (name: string) => {
          deleted.push(name);
          return true;
        },
        open: async () => ({
          put: async () => {
            puts++;
          },
          match: async () => new Response('old account data'),
        }),
      },
      fetch: () => network,
    },
  );
  return {
    handlers,
    deleted,
    resolveFetch,
    rejectFetch,
    puts: () => puts,
    async clear() {
      let completion: Promise<void> | undefined;
      let acknowledged = false;
      handlers.get('message')!({
        request: new Request('https://activitymap.cc'),
        data: { type: 'CLEAR_ACCOUNT_DATA' },
        ports: [
          {
            postMessage: () => {
              acknowledged = true;
            },
          },
        ],
        waitUntil: (promise) => {
          completion = promise;
        },
        respondWith: () => undefined,
      });
      await completion;
      assert.equal(acknowledged, true);
    },
    fetch(mode: 'navigate' | 'image') {
      const request = new Request('https://activitymap.cc/map');
      Object.defineProperty(
        request,
        mode === 'navigate' ? 'mode' : 'destination',
        { value: mode },
      );
      let response: Promise<Response> | undefined;
      handlers.get('fetch')!({
        request,
        waitUntil: () => undefined,
        respondWith: (promise) => {
          response = promise;
        },
      });
      return response!;
    },
  };
}

void test('deletion clears all ActivityMap service-worker cache versions and acknowledges completion', async () => {
  const fixture = workerFixture();
  await fixture.clear();
  assert.deepEqual(fixture.deleted, [
    'activitymap-shell-v3',
    'activitymap-static-v3',
    'activitymap-shell-v2',
  ]);
});
void test('an image response started before deletion cannot repopulate the static cache', async () => {
  const fixture = workerFixture();
  await fixture.fetch('image');
  await fixture.clear();
  fixture.resolveFetch(new Response('old image'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.puts(), 0);
});
void test('a failed navigation started before deletion cannot serve old cached account HTML', async () => {
  const fixture = workerFixture();
  const response = fixture.fetch('navigate');
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.clear();
  fixture.rejectFetch(new Error('offline'));
  assert.equal((await response).status, 503);
  assert.equal(fixture.puts(), 0);
});
