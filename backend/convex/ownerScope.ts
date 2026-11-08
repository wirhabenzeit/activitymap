import { v } from 'convex/values';

export const actorFields = { userId: v.string(), athleteId: v.string() };
export const scopeFields = { ...actorFields, epoch: v.string() };
