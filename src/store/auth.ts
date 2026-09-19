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
      if (auth.guestMode) {
        state.isGuest = true;
        state.guestMode = {
          type: auth.guestMode.type,
          userId: auth.guestMode.userId,
          activityIds: auth.guestMode.activityIds,
        };
      } else {
        state.user = auth.currentUser ?? undefined;
      }
      state.isInitialized = true;
    });
  },
});
