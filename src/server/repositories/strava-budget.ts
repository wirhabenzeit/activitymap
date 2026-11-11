import 'server-only';

import { convexStravaRequestBudget } from '~/server/auth/convex-app-state';
import type { StravaRequestBudget } from '~/server/strava/request-budget';

/** The shared Strava request budget, kept in Convex
 * (`backend/convex/appState.ts`). */
export function createStravaRequestBudget(reserves?: {
  fifteenMinutes: number;
  daily: number;
  maxInFlight?: number;
}): StravaRequestBudget {
  return convexStravaRequestBudget(reserves);
}
export const stravaRequestBudget = createStravaRequestBudget();
