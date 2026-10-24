'use client';

import type { QueryClient } from '@tanstack/react-query';

/** A QueryClient belongs to one browser app (or one isolated server render). */
type Registration = {
  controller: AbortController;
  active: boolean;
  requested: number;
  completed: number;
  commits: Array<{
    version: number;
    apply: (signal: AbortSignal) => Promise<void>;
  }>;
  running?: Promise<void>;
  run: (signal: AbortSignal) => Promise<void>;
};
type Registry = {
  scopes: Map<string, Registration>;
  cleanup: Promise<void>;
};
const registries = new WeakMap<QueryClient, Registry>();
const registryFor = (client: QueryClient): Registry => {
  let registry = registries.get(client);
  if (!registry) {
    registry = { scopes: new Map(), cleanup: Promise.resolve() };
    registries.set(client, registry);
  }
  return registry;
};
const aborted = () =>
  new DOMException('The library session changed', 'AbortError');

function stop(registration: Registration) {
  registration.active = false;
  registration.controller.abort(aborted());
}

/** During first mount a reader can precede the provider's registration. */
export class LibrarySyncNotReadyError extends Error {
  constructor() {
    super('The signed-in library is not ready to sync.');
  }
}

/** The authenticated provider is the only network writer for this scope. */
export function registerLibrarySync(
  client: QueryClient,
  scope: string,
  run: (signal: AbortSignal) => Promise<void>,
): () => void {
  const registry = registryFor(client);
  const previous = registry.scopes.get(scope);
  if (previous) {
    stop(previous);
    // Strict Mode/remounts must let aborted IDB transactions settle first.
    const preceding = registry.cleanup;
    registry.cleanup = Promise.allSettled([preceding, previous.running]).then(
      () => undefined,
    );
  }
  const registration: Registration = {
    controller: new AbortController(),
    active: true,
    requested: 0,
    completed: 0,
    commits: [],
    run,
  };
  registry.scopes.set(scope, registration);
  return () => {
    stop(registration);
    if (registry.scopes.get(scope) === registration) {
      // An old effect cleanup must never remove the next session's registration.
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory registry
      registry.scopes.delete(scope);
      registry.cleanup = Promise.allSettled([
        registry.cleanup,
        registration.running,
      ]).then(() => undefined);
    }
  };
}

/**
 * Await a committed download. Requests during a pass schedule one follow-up:
 * joining a pass that started before an edit could otherwise miss that edit.
 * Calls made before the next pass starts coalesce; failures remain retryable.
 */
export function requestLibrarySync(
  client: QueryClient,
  scope: string,
  commit?: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const registry = registryFor(client);
  const registration = registry.scopes.get(scope);
  if (!registration?.active)
    return Promise.reject(new LibrarySyncNotReadyError());
  const requested = ++registration.requested;
  if (commit) registration.commits.push({ version: requested, apply: commit });
  const current = () => {
    registration.controller.signal.throwIfAborted();
    if (!registration.active || registry.scopes.get(scope) !== registration)
      throw aborted();
  };
  return (async () => {
    // Each caller waits for its own request version. A request arriving between
    // the drain loop and its finalizer cannot accidentally join an older pass.
    while (registration.completed < requested) {
      current();
      if (!registration.running) {
        const precedingCleanup = registry.cleanup;
        const task = Promise.resolve()
          .then(async () => {
            await precedingCleanup;
            current();
            while (registration.completed < registration.requested) {
              const version = registration.requested;
              // Mutation responses use the same serialized writer as downloads.
              // A queued response cannot race an older bootstrap/delta commit.
              while (
                registration.commits[0] &&
                registration.commits[0].version <= version
              ) {
                const next = registration.commits.shift()!;
                await next.apply(registration.controller.signal);
                current();
              }
              await registration.run(registration.controller.signal);
              current();
              registration.completed = version;
            }
          })
          .finally(() => {
            if (registration.running === task) registration.running = undefined;
          });
        registration.running = task;
      }
      await registration.running;
    }
    current();
  })();
}

/**
 * Fence a departing account synchronously, then serialize disk cleanup before
 * any next session downloads. This also protects rapid A -> B -> A switches.
 * The caller clears its observable snapshot synchronously before this call.
 */
export function retireLibrarySync(
  client: QueryClient,
  scope: string,
  cleanup: () => Promise<void>,
): Promise<void> {
  const registry = registryFor(client);
  const previous = registry.scopes.get(scope);
  if (previous) {
    stop(previous);
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory registry
    registry.scopes.delete(scope);
  }
  const task = Promise.allSettled([registry.cleanup, previous?.running]).then(
    cleanup,
  );
  // A cleanup error is reported to its caller without wedging unrelated accounts.
  registry.cleanup = task.catch(() => undefined);
  return task;
}
