import { type StateCreator } from 'zustand';

import { type RootState } from './index';
import {
  updateActivity as updateStravaActivity,
  deleteActivities as deleteServerActivities,
} from '~/server/strava/actions';

export type ActivitySlice = object;

export const createActivitySlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  ActivitySlice
> = (_set, _get, _store) => {
  return {
    // Initial state

    // Actions
  };
};

export const serverActions = {
  deleteServerActivities,
  updateStravaActivity,
};
