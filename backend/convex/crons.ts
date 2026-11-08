import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval(
  'compact expired sync changes',
  { hours: 24 },
  internal.maintenance.compactChanges,
  {},
);
export default crons;
