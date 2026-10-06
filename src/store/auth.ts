import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import type { CurrentUserDTO } from '~/server/db/dto';

export type InitialAuth = {
  currentUser: CurrentUserDTO | null;
  guestMode?: {
    type: 'user' | 'activities';
    userId?: string;
    activityIds?: number[];
  };
};

export type AuthState = {
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
      if (
        state.user?.id !== nextUser?.id ||
        state.isGuest !== Boolean(auth.guestMode) ||
        JSON.stringify(state.guestMode) !==
          JSON.stringify(auth.guestMode ?? { type: null })
      ) {
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
