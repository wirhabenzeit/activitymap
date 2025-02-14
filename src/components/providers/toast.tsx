'use client';

import { useEffect } from 'react';
import { useToast } from '~/hooks/use-toast';
import { useShallowStore } from '~/store';

export function ToastManager() {
  const { toast } = useToast();
  const { notifications, removeNotification } = useShallowStore((state) => ({
    notifications: state.notifications,
    removeNotification: state.removeNotification,
  }));

  useEffect(() => {
    notifications.forEach((notification) => {
      toast({
        title: notification.title,
        description: notification.message,
        variant: notification.type === 'error' ? 'destructive' : 'default',
      });
      removeNotification(notification.id);
    });
  }, [notifications, removeNotification, toast]);

  return null;
}
