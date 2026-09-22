import type { StravaRateLimitUsage } from './client';

export type StravaBudgetTicket = { startedAt: Date; read: boolean };
export interface StravaRequestBudget {
  reserve(read: boolean): Promise<StravaBudgetTicket>;
  observe(
    ticket: StravaBudgetTicket,
    usage: StravaRateLimitUsage | null,
    status: number,
  ): Promise<void>;
}
export class StravaBudgetExceededError extends Error {
  readonly status = 429;
  constructor(public readonly retryAfterSeconds: number) {
    super('The shared Strava request budget is exhausted');
    this.name = 'StravaBudgetExceededError';
  }
}

export const STRAVA_RATE_LIMIT_15_MINUTE_RESERVE = 25;
export const STRAVA_RATE_LIMIT_DAILY_RESERVE = 100;
