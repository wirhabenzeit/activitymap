import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';
import { JOBS } from './jobHealth';

/** Each job records its success (convex/jobHealth.ts) under its key. */
const crons = cronJobs();
crons.interval(
  'compact expired sync changes',
  JOBS['compact-changes'],
  internal.maintenance.compactChanges,
  {},
);
crons.interval(
  'expire bridge write nonces',
  JOBS['expire-nonces'],
  internal.bridge.expireNonces,
  {},
);
crons.interval(
  'expire provider event receipts',
  JOBS['expire-provider-events'],
  internal.maintenance.expireProviderEvents,
  {},
);
crons.interval(
  'expire API rate limit windows',
  JOBS['expire-rate-limits'],
  internal.appState.expireOldRateLimits,
  {},
);
crons.interval(
  'resume place re-match walks',
  JOBS['resume-rematch-walks'],
  internal.maintenance.resumeRematchWalks,
  {},
);
export default crons;
