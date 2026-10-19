import assert from 'node:assert/strict';

import test from 'node:test';
import { immer } from 'zustand/middleware/immer';
import { createStore } from 'zustand/vanilla';

import type { CurrentUserDTO } from '~/server/db/dto';

import { createAuthSlice } from './auth';
import type { RootState } from './index';

void test('account epochs are stable for profile refreshes and change on departure, return and disconnect', () => {
  const state = createStore<RootState>()(
    immer((...args) => ({ ...createAuthSlice(...args) }) as RootState),
  );
  const alice = { id: 'alice', stravaConnected: true } as CurrentUserDTO;
  const login = state.getState().initializeAuth;
  login({ currentUser: alice });
  const first = state.getState().authSession;
  assert(first > 0);
  login({ currentUser: { ...alice, name: 'Updated profile' } });
  assert.equal(state.getState().authSession, first);
  login({ currentUser: null });
  login({ currentUser: alice });
  assert.equal(state.getState().authSession, first + 2);
  login({ currentUser: { ...alice, stravaConnected: false } });
  assert.equal(state.getState().authSession, first + 3);
  login({ currentUser: { ...alice, stravaConnected: false } });
  assert.equal(state.getState().authSession, first + 3);
});
