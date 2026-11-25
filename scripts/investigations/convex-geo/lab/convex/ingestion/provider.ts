import type { Infer } from 'convex/values';

import { FIXTURE_SAMPLES, generateFixture } from '../../recording/fixtures';
import type { fault, fixture } from './validators';

type FixtureRequest = {
  key: string;
  version: number;
  fixture: Infer<typeof fixture>;
  fault?: Infer<typeof fault>;
};

type Response =
  | { status: 200; payload: unknown }
  | { status: 401 | 403 | 429 | 500; retryAfterMs?: number };

// These are synthetic responses, with the same separate reservation boundaries
// used for provider requests. An adapter with network credentials is out of scope.
export const fixtureProvider = {
  async refresh(credential: number) {
    return { previous: credential, next: credential + 1 };
  },
  async detail({ key, version }: FixtureRequest) {
    return { name: `Fixture ${key} revision ${version}` };
  },
  async streams(request: FixtureRequest): Promise<Response> {
    switch (request.fault) {
      case '429':
        return { status: 429, retryAfterMs: 4_000 };
      case '401':
        return { status: 401 };
      case '403':
        return { status: 403 };
      case '500':
        return { status: 500 };
      default:
        return {
          status: 200,
          payload:
            request.fixture === 'empty'
              ? {}
              : generateFixture(FIXTURE_SAMPLES[request.fixture]),
        };
    }
  },
};
