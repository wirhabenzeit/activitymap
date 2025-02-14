import { type StateCreator } from 'zustand';
import { type RootState } from './index';

export type NotificationType = 'success' | 'error' | 'info';

export type Notification = {
  id: string;
  type: NotificationType;
  title?: string;
  message: string;
};

export type NotificationState = {
  notifications: Notification[];
};

export type NotificationActions = {
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: string) => void;
};

export type NotificationSlice = NotificationState & NotificationActions;

export const createNotificationSlice: StateCreator<
  RootState,
  [['zustand/immer', never]],
  [],
  NotificationSlice
> = (set) => ({
  // Initial state
  notifications: [],

  // Actions
  addNotification: (notification) => {
    set((state) => {
      state.notifications.push({
        ...notification,
        id: crypto.randomUUID(),
      });
    });
  },

  removeNotification: (id) => {
    set((state) => {
      state.notifications = state.notifications.filter((n) => n.id !== id);
      console.log('Notifications after removal:', state.notifications);
    });
  },
});
