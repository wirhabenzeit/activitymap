import { v } from 'convex/values';

export const actorFields = { userId: v.string(), athleteId: v.string() };
export const scopeFields = { ...actorFields, epoch: v.string() };

/** Which store ingests and writes an owner's library. `handoff` means
 * neither: both stop while the owner moves from one to the other. */
export const writerValidator = v.union(
  v.literal('postgres'),
  v.literal('handoff'),
  v.literal('convex'),
);
export type Writer = 'postgres' | 'handoff' | 'convex';
