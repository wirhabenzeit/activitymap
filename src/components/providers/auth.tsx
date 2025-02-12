'use client';

import { useEffect } from 'react';
import { useShallowStore } from '~/store';
import type { Session } from 'next-auth';
import type { User, Account } from '~/server/db/schema';
import type { InitialAuth as InitialAuth } from '~/store/auth';

export function AuthProvider({
  initialAuth,
  children,
}: {
  initialAuth: InitialAuth;
  children: React.ReactNode;
}) {
  const { initializeAuth, loadFromDB, loadPhotos, session, user, account } =
    useShallowStore((state) => ({
      initializeAuth: state.initializeAuth,
      loadFromDB: state.loadFromDB,
      loadPhotos: state.loadPhotos,
      session: state.session,
      user: state.user,
      account: state.account,
    }));

  useEffect(() => {
    if (initialAuth.session) {
      initializeAuth(initialAuth);

      // Load initial data
      loadFromDB({}).catch(console.error);
      loadPhotos().catch(console.error);
      console.log(session, user, account);
    }
  }, [initialAuth, initializeAuth, loadFromDB, loadPhotos]);

  return <>{children}</>;
}
