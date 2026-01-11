import { type StateCreator } from 'zustand';

import { type RootState } from './index';
import {
  fetchStravaActivities,
  updateActivity as updateStravaActivity,
  deleteActivities as deleteServerActivities,
} from '~/server/strava/actions';

export type ActivityState = {
  // Pending further refactoring, we might keep some UI state here
  // But for now, we've moved data to React Query
};

export type ActivityActions = {
  // Actions that don't depend on local data cache
};

export type ActivitySlice = ActivityState & ActivityActions;

export const createActivitySlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  ActivitySlice
> = (set, get, store) => {
  return {
    // Initial state

    // Actions
  };
};

export const serverActions = {
  fetchStravaActivities,
  deleteServerActivities,
  updateStravaActivity,
};

