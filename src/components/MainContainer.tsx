"use client";

import {useSearchParams} from "next/navigation";
import {useEffect} from "react";
import {useStore} from "~/contexts/Zustand";
import {getUser} from "~/server/db/actions";
import type {User, Session} from "~/server/db/schema";

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
    updateFilters,
    setFilterRanges,
    toggleUserSettings,
    setUser,
    setGuest,
    setLoading,
    setSession,
  } = useStore((state) => ({
    loadFromDB: state.loadFromDB,
    updateFilters: state.updateFilters,
    setFilterRanges: state.setFilterRanges,
    toggleUserSettings: state.toggleUserSettings,
    loadPhotos: state.loadPhotos,
    setUser: state.setUser,
    setGuest: state.setGuest,
    setLoading: state.setLoading,
    setSession: state.setSession,
  }));

  const searchParams = useSearchParams();

  useEffect(() => {
    if (session !== undefined) setSession(session);
    if (user != undefined) {
      setUser(user);
      load().then(console.log).catch(console.error);
    } else if (searchParams.has("user")) {
      async function getUserFromDB() {
        const user = await getUser(
          searchParams.get("user")!
        );
        if (user) {
          console.log("setting user", user);
          setUser(user);
          setGuest(true);
          load().then(console.log).catch(console.error);
        }
      }
      getUserFromDB()
        .then(console.log)
        .catch(console.error);
    } else if (searchParams.has("activities")) {
      console.log(searchParams.get("activities"));
      setGuest(true);
      const activities = searchParams
        .get("activities")
        ?.split(",")
        .map(Number);
      load(activities)
        .then(console.log)
        .catch(console.error);
    } else {
      setLoading(false);
    }

    async function load(activities?: number[]) {
      const nActivities = await loadFromDB({
        ids: activities,
      });
      await loadPhotos();
      if (nActivities === 0) toggleUserSettings();
    }

    const unsub = useStore.subscribe((state, prevState) => {
      if (
        state.categories !== prevState.categories ||
        state.binary !== prevState.binary ||
        state.search !== prevState.search ||
        state.values !== prevState.values
      ) {
        updateFilters();
      } else if (
        state.activityDict !== prevState.activityDict
      ) {
        setFilterRanges();
        updateFilters();
      }
    });

    return unsub;
  }, []);

  return <>{children}</>;
}
