import { message } from './presentation/messages';
import type { StravaPermissions } from './strava-permissions';

type MutationAuth = {
  isGuest: boolean;
  user?: {
    stravaConnected: boolean;
    stravaPermissions?: StravaPermissions | null;
  };
};

/** Unknown historical grants stay usable; a known denied write grant does not. */
export function activityMutationAvailability(auth: MutationAuth) {
  const canRefresh = !auth.isGuest && !!auth.user?.stravaConnected;
  const canEdit = canRefresh && auth.user?.stravaPermissions?.edit !== false;
  return {
    canRefresh,
    canEdit,
    editReason: canEdit
      ? undefined
      : canRefresh
        ? `${message('permission.edit')} ${message('permission.reconnect')}`
        : message('activity.action.connectStrava'),
  };
}

/** Recheck immediately before sending, including when a form outlives its grant. */
export function assertActivityMutationAvailable(
  auth: MutationAuth,
  operation: 'edit' | 'refresh',
) {
  const availability = activityMutationAvailability(auth);
  if (operation === 'edit' ? availability.canEdit : availability.canRefresh)
    return;
  throw new Error(availability.editReason ?? message('permission.reconnect'));
}
