"use client";

import {useSearchParams} from "next/navigation";
import {parse} from "path";
import {useEffect} from "react";
import {useStore} from "~/contexts/Zustand";
import {db} from "~/server/db";
import {getUserAccount} from "~/server/db/actions";
import type {Account, User} from "~/server/db/schema";

export default function MainContainer({
  account,
  user,
  children,
}: {
  children: React.ReactNode;
  account?: Account;
  user?: User;
}) {
  const {
    loadFromDB,
    loadPhotos,
    updateFilters,
    setFilterRanges,
    setAccount,
    toggleUserSettings,
    setUser,
    setGuest,
  } = useStore((state) => ({
    loadFromDB: state.loadFromDB,
    updateFilters: state.updateFilters,
    setFilterRanges: state.setFilterRanges,
    setAccount: state.setAccount,
    toggleUserSettings: state.toggleUserSettings,
    loadPhotos: state.loadPhotos,
    setUser: state.setUser,
    setGuest: state.setGuest,
  }));

  const searchParams = useSearchParams();

  useEffect(() => {
    if (account != undefined && user != undefined) {
      setAccount(account);
      setUser(user);
      load().then(console.log).catch(console.error);
    } else if (searchParams.has("user")) {
      async function getUser() {
        const {user, account} = await getUserAccount(
          searchParams.get("user")!
        );
        if (account && user) {
          console.log(
            "setting account user",
            account,
            user
          );
          setAccount(account);
          setUser(user);
          setGuest(true);
          load().then(console.log).catch(console.error);
        }
      }
      getUser().then(console.log).catch(console.error);
    } else if (searchParams.has("activities")) {
      console.log(searchParams.get("activities"));
      setGuest(true);
      const activities = searchParams
        .get("activities")
        ?.split(",")
        .map(Number);
      console.log("loading activities", activities);
      load(activities)
        .then(console.log)
        .catch(console.error);
    } else {
      setGuest(true);
    }

    async function load(activities?: number[]) {
      console.log("loading activities");
      const nActivities = await loadFromDB(activities);
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
