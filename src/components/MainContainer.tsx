"use client";

import {useEffect} from "react";
import {useStore} from "~/contexts/Zustand";
import type {Account} from "~/server/db/schema";

export default function MainContainer({
  account,
  children,
}: {
  children: React.ReactNode;
  account?: Account;
}) {
  const {
    loadFromDB,
    updateFilters,
    setFilterRanges,
    setAccount,
    toggleUserSettings,
  } = useStore((state) => ({
    loadFromDB: state.loadFromDB,
    updateFilters: state.updateFilters,
    setFilterRanges: state.setFilterRanges,
    setAccount: state.setAccount,
    toggleUserSettings: state.toggleUserSettings,
  }));

  useEffect(() => {
    if (account) setAccount(account);
    async function load() {
      const nActivities = await loadFromDB();
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
    load().catch(console.error);
    return unsub;
  }, []);

  return <>{children}</>;
}
