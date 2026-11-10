import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval(
  'compact expired sync changes',
  { hours: 24 },
  internal.maintenance.compactChanges,
  {},
);
crons.interval(
  'expire bridge write nonces',
  { hours: 1 },
  internal.bridge.expireNonces,
  {},
);
crons.interval(
  'expire provider event receipts',
  { hours: 24 },
  internal.maintenance.expireProviderEvents,
  {},
);
export default crons;
