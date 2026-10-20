import { type StateCreator } from 'zustand';

import type { CurrentUserDTO } from '~/server/db/dto';

import { resetBrowsingContext } from './browsing';
import { type RootState } from './index';

export type InitialAuth = {
  currentUser: CurrentUserDTO | null;
  guestMode?: {
    type: 'user' | 'activities';
    userId?: string;
    activityIds?: number[];
  };
};

export type AuthState = {
  /** In-memory lifetime used to fence asynchronous account work. Never persisted. */
  authSession: number;
  user: CurrentUserDTO | undefined;
  isInitialized: boolean;
  isGuest: boolean;
  guestMode: {
    type: 'user' | 'activities' | null;
    userId?: string;
    activityIds?: number[];
  };
};

export type AuthActions = {
  initializeAuth: (auth: InitialAuth) => void;
};

export type AuthSlice = AuthState & AuthActions;

export const createAuthSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  AuthSlice
> = (set) => ({
  // Initial state
  authSession: 0,
  user: undefined,
  isInitialized: false,
  isGuest: false,
  guestMode: {
    type: null,
    userId: undefined,
    activityIds: undefined,
  },

  // Actions
  initializeAuth: (auth) => {
    set((state) => {
      const nextUser = auth.currentUser ?? undefined;
      const accountChanged =
        state.user?.id !== nextUser?.id ||
        state.isGuest !== Boolean(auth.guestMode) ||
        JSON.stringify(state.guestMode) !==
          JSON.stringify(auth.guestMode ?? { type: null });
      if (
        !state.isInitialized ||
        accountChanged ||
        state.user?.stravaConnected !== nextUser?.stravaConnected
      ) {
        state.authSession += 1;
      }
      if (accountChanged) {
        resetBrowsingContext();
        state.combineSelections = false;
        state.onlySelected = false;
        state.selected = [];
        state.highlighted = 0;
        state.knownSelectionIDs = null;
        state.visibleSelectionIDs = null;
      }
      state.user = nextUser;
      state.isGuest = Boolean(auth.guestMode);
      if (auth.guestMode) {
        state.isGuest = true;
        state.guestMode = {
          type: auth.guestMode.type,
          userId: auth.guestMode.userId,
          activityIds: auth.guestMode.activityIds,
        };
      } else {
        state.guestMode = { type: null };
        state.user = auth.currentUser ?? undefined;
      }
      state.isInitialized = true;
    });
  },
});
