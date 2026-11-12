import {
  type ApiFromModules,
  type FilterApi,
  type FunctionReference,
  anyApi,
} from 'convex/server';

import type * as seedFunctions from './seed';

type SeedApi = FilterApi<
  ApiFromModules<{ seed: typeof seedFunctions }>,
  FunctionReference<'query' | 'mutation' | 'action', 'internal'>
>;

/** Typed references to the test-only `seed` module (`./seed.ts`). */
export const testWrites = (anyApi as unknown as SeedApi).seed;

/** Register this in a test's module map to make `testWrites` callable. */
export const seedModule = {
  './seed.ts': () => import('./seed'),
};
