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

void test('place interaction state is cleared on account changes, logout and disconnection', async () => {
  const { useActivityPlaceFocus } = await import('./activity-place-focus');
  const state = createStore<RootState>()(
    immer((...args) => ({ ...createAuthSlice(...args) }) as RootState),
  );
  const alice = { id: 'alice', stravaConnected: true } as CurrentUserDTO;
  const login = state.getState().initializeAuth;
  const focus = () =>
    useActivityPlaceFocus
      .getState()
      .setFocus({
        userId: 'alice',
        activityId: '123',
        placeId: 'place',
        visitIndex: 0,
        source: 'profile',
      });
  login({ currentUser: alice });
  focus();
  login({ currentUser: { ...alice, name: 'Updated profile' } });
  assert.equal(useActivityPlaceFocus.getState().focus?.activityId, '123');
  login({ currentUser: { ...alice, id: 'bob' } });
  assert.equal(useActivityPlaceFocus.getState().focus, null);
  login({ currentUser: alice });
  focus();
  login({ currentUser: null });
  assert.equal(useActivityPlaceFocus.getState().focus, null);
  login({ currentUser: alice });
  focus();
  login({ currentUser: { ...alice, stravaConnected: false } });
  assert.equal(useActivityPlaceFocus.getState().focus, null);
});
