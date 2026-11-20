import { v } from 'convex/values';

export const fixture = v.union(
  v.literal('small'),
  v.literal('typical'),
  v.literal('empty'),
);
export const fault = v.union(
  v.literal('before-detail'),
  v.literal('after-detail'),
  v.literal('before-streams'),
  v.literal('after-streams'),
  v.literal('before-upload'),
  v.literal('after-upload'),
  v.literal('during-commit'),
  v.literal('after-commit'),
  v.literal('before-refresh'),
  v.literal('after-refresh'),
  v.literal('overlap-refresh'),
  v.literal('overlap'),
  v.literal('hold-upload'),
  v.literal('429'),
  v.literal('401'),
  v.literal('403'),
  v.literal('500'),
);
export const event = {
  key: v.string(),
  version: v.number(),
  deleted: v.boolean(),
  fixture,
  fault: v.optional(fault),
};
export const claim = { job: v.id('ingestionJobs'), attempt: v.number() };
export const request = v.union(
  v.literal('refresh'),
  v.literal('detail'),
  v.literal('streams'),
);
export const phase = v.union(
  v.literal('queued'),
  v.literal('fetch'),
  v.literal('refresh'),
  v.literal('detail'),
  v.literal('streams'),
  v.literal('upload'),
  v.literal('complete'),
  v.literal('deleted'),
);
