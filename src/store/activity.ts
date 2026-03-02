import { type StateCreator } from 'zustand';

import { type RootState } from './index';
import {
  fetchStravaActivities,
  updateActivity as updateStravaActivity,
  deleteActivities as deleteServerActivities,
} from '~/server/strava/actions';

export type ActivityState = {};

export type ActivityActions = {};

export type ActivitySlice = ActivityState & ActivityActions;

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
  fetchStravaActivities,
  deleteServerActivities,
  updateStravaActivity,
};
