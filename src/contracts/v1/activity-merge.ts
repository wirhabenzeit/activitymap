import { z } from 'zod';

import {
  MERGE_MAX_PARTS,
  MERGE_MIN_PARTS,
} from '~/lib/activity-merge/eligibility';

import { editableActivityFields } from './activity-mutations';
import { idString } from './primitives';

/**
 * Merging consecutive activities into one (web first; not yet in the
 * OpenAPI document the iOS client is generated from).
 *
 * `POST /api/v1/activity-merges/file` answers the merged FIT file.
 * `POST /api/v1/activity-merges` uploads it to Strava as a new activity and
 * waits briefly for Strava to process it. When Strava is slower, the answer
 * is `processing` and the client continues with
 * `POST /api/v1/activity-merges/uploads/{upload_id}`, sending the same
 * metadata, until the upload is `ready` or `failed`.
 *
 * Strava's API cannot delete activities: the originals stay until the
 * athlete deletes them on Strava, and the library drops them when Strava
 * reports the deletion.
 */

/** Settings for the merged activity, applied once Strava created it. */
export const mergedActivityMetadataSchema = z.strictObject({
  name: editableActivityFields.name,
  description: editableActivityFields.description,
  sport_type: editableActivityFields.sport_type,
  commute: z.boolean().optional(),
  hide_from_home: z.boolean().optional(),
  gear_id: z.string().max(64).nullable().optional(),
});
export type MergedActivityMetadata = z.infer<
  typeof mergedActivityMetadataSchema
>;

const activityIds = z
  .array(idString)
  .min(MERGE_MIN_PARTS)
  .max(MERGE_MAX_PARTS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Activity IDs must be distinct',
  });

export const mergeFileRequestSchema = z.strictObject({
  activity_ids: activityIds,
  sport_type: editableActivityFields.sport_type.optional(),
});
export type MergeFileRequest = z.infer<typeof mergeFileRequestSchema>;

export const mergeActivitiesRequestSchema = mergedActivityMetadataSchema.extend(
  {
    activity_ids: activityIds,
  },
);
export type MergeActivitiesRequest = z.infer<
  typeof mergeActivitiesRequestSchema
>;

export const mergeUploadStateSchema = z.object({
  upload_id: idString,
  status: z.enum(['processing', 'ready', 'failed']),
  /** The merged activity, once Strava created it. */
  activity_id: idString.nullable(),
  /** Strava's reason when the upload failed. */
  error: z.string().nullable(),
  /** Set when Strava rejected the upload as a duplicate of this activity. */
  duplicate_of: idString.nullable(),
  /** Whether name, sport and settings were applied after processing. A
   * failure here leaves a created activity with the upload's defaults. */
  metadata_applied: z.boolean(),
});
export type MergeUploadState = z.infer<typeof mergeUploadStateSchema>;
