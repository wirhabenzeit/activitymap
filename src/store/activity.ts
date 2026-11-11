import { type StateCreator } from 'zustand';

import { type RootState } from './index';

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
