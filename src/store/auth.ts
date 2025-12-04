import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import type { User, Account } from '~/server/db/schema';
import type { Session } from '~/lib/auth';

export type InitialAuth = {
  session: Session | null;
  user: User | null;
  account: Account | null;
  guestMode?: {
    type: 'user' | 'activities';
    userId?: string;
    activityIds?: number[];
  };
};

export type AuthState = {
  user: User | undefined;
  session: Session | undefined;
  account: Account | undefined;
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
  [['zustand/immer', never]],
  [],
  AuthSlice
> = (set) => ({
  // Initial state
  user: undefined,
  session: undefined,
  account: undefined,
  isInitialized: false,
  isGuest: false,
  guestMode: {
    type: null,
    userId: undefined,
    activityIds: undefined,
  },

  // Actions
  initializeAuth: (auth) => {
    console.log('Initializing auth with:', auth);
    set((state) => {
      if (auth.guestMode) {
        state.isGuest = true;
        state.guestMode = {
          type: auth.guestMode.type,
          userId: auth.guestMode.userId,
          activityIds: auth.guestMode.activityIds,
        };
      } else {
        state.session = auth.session ?? undefined;
        state.user = auth.user ?? undefined;
        state.account = auth.account ?? undefined;
      }
      state.isInitialized = true;

      console.log('Auth state after initialization:', {
        isGuest: state.isGuest,
        guestMode: state.guestMode,
        user: state.user,
        account: state.account,
        isInitialized: state.isInitialized,
      });
    });
  },
});
