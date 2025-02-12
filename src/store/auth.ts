import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import type { User, Account } from '~/server/db/schema';
import type { Session } from 'next-auth';

export type InitialAuth = {
  session: Session | null;
  user: User | null;
  account: Account | null;
};

export type AuthState = {
  user: User | undefined;
  session: Session | undefined;
  account: Account | undefined;
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
> = (set, get) => ({
  // Initial state
  user: undefined,
  session: undefined,
  account: undefined,

  // Actions
  initializeAuth: (auth) => {
    set((state) => {
      state.session = auth.session ?? undefined;
      state.user = auth.user ?? undefined;
      state.account = auth.account ?? undefined;
    });

    // Initialize activities if we have an account
    if (auth.account) {
      get().loadFromDB({});
    }
  },
});
