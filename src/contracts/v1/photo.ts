import { z } from 'zod';
import type { Photo } from '~/server/db/schema';
import { idString, isoDateTime, toIdString, toIsoDateTime } from './primitives';

/** The v1 wire shape of a photo. See `activity.ts` for the id/date rules. */
export const photoDTOSchema = z.object({
  unique_id: z.string(),
  activity_id: idString,
  athlete_id: idString,
  activity_name: z.string().nullable(),
  caption: z.string().nullable(),
  type: z.number().int(),
  source: z.number().int().nullable(),
  urls: z.record(z.string(), z.string()).nullable(),
  sizes: z.record(z.string(), z.tuple([z.number(), z.number()])).nullable(),
  default_photo: z.boolean().nullable(),
  location: z.array(z.number()).nullable(),
  uploaded_at: isoDateTime.nullable(),
  created_at: isoDateTime.nullable(),
  post_id: z.number().int().nullable(),
  status: z.string().nullable(),
  resource_state: z.number().int().nullable(),
});

export type PhotoDTO = z.infer<typeof photoDTOSchema>;

export function toPhotoDTO(photo: Photo): PhotoDTO {
  return photoDTOSchema.parse({
    unique_id: photo.unique_id,
    activity_id: toIdString(photo.activity_id),
    athlete_id: toIdString(photo.athlete_id),
    activity_name: photo.activity_name,
    caption: photo.caption,
    type: photo.type,
    source: photo.source,
    urls: photo.urls,
    sizes: photo.sizes,
    default_photo: photo.default_photo,
    location: photo.location,
    uploaded_at: photo.uploaded_at ? toIsoDateTime(photo.uploaded_at) : null,
    created_at: photo.created_at ? toIsoDateTime(photo.created_at) : null,
    post_id: photo.post_id,
    status: photo.status,
    resource_state: photo.resource_state,
  });
}
