'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useShallowStore } from '~/store';
import { getAccount, getUser } from '~/server/db/actions';
import type { User, Session } from '~/server/db/schema';

export default function MainContainer({
  user,
  session,
  children,
}: {
  children: React.ReactNode;
  session?: Session;
  user?: User;
}) {
  const {
    loadFromDB,
    loadPhotos,
    setUser,
    setAccount,
    setGuest,
    setLoading,
    setSession,
  } = useShallowStore((state) => ({
    loadFromDB: state.loadFromDB,
    loadPhotos: state.loadPhotos,
    setUser: state.setUser,
    setAccount: state.setAccount,
    setGuest: state.setGuest,
    setLoading: state.setLoading,
    setSession: state.setSession,
  }));

  const searchParams = useSearchParams();

  useEffect(() => {
    if (session !== undefined) setSession(session);

    if (user != undefined) {
      // Handle logged-in user initialization
      setUser(user);
      getAccount({ userId: user.id })
        .then((account) => {
          if (account) setAccount(account);
          return loadFromDB({});
        })
        .then(() => loadPhotos())
        .catch(console.error);
    } else if (searchParams.has('user')) {
      // Handle guest user view
      getUser(searchParams.get('user')!)
        .then(async (user) => {
          if (user) {
            setUser(user);
            const account = await getAccount({ userId: user.id });
            setGuest(true);
            return loadFromDB({ athleteId: account.providerAccountId });
          }
        })
        .then(() => loadPhotos())
        .catch(console.error);
    } else if (searchParams.has('activities')) {
      // Handle specific activities view
      setGuest(true);
      const activities = searchParams.get('activities')?.split(',').map(Number);
      loadFromDB({ ids: activities })
        .then(() => loadPhotos())
        .catch(console.error);
    } else {
      setLoading(false);
    }
  }, []);

  return <>{children}</>;
}
