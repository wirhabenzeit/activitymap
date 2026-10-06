'use client';

import { useEffect, useRef, useState } from 'react';

import { useActivities } from '~/hooks/use-activities';
import {
  advanceIndicator,
  hiddenIndicator,
  isActivityLoadBusy,
} from '~/lib/activity-loading';
import { useBrowserSyncStatus } from '~/lib/sync/browser-status';
import { useShallowStore } from '~/store';

/** Whether the avatar shows its activity-loading indicator (#309). */
export function useActivityLoadIndicator() {
  const { isFetching, hasNextPage, isError, isFetchNextPageError } =
    useActivities();
  const userId = useShallowStore((state) => state.user?.id);
  const syncPhase = useBrowserSyncStatus((state) =>
    userId ? state.byUser[userId]?.phase : undefined,
  );
  const busy = isActivityLoadBusy(
    { isFetching, hasNextPage, isError, isFetchNextPageError },
    syncPhase,
  );

  const state = useRef(hiddenIndicator);
  const account = useRef(userId);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // A different account starts from a hidden indicator.
    if (account.current !== userId) {
      account.current = userId;
      state.current = hiddenIndicator;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      const next = advanceIndicator(state.current, busy, Date.now());
      state.current = next.state;
      setVisible(next.state.visible);
      if (next.wakeAt !== null) {
        timer = setTimeout(step, Math.max(0, next.wakeAt - Date.now()));
      }
    };
    step();
    return () => clearTimeout(timer);
  }, [busy, userId]);

  return visible;
}
