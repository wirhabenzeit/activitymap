import { z } from 'zod';

import {
  editableActivityFields,
  updateActivityRequestSchema,
} from '~/contracts/v1/activity-mutations';

export const activityEditSchema = z.object({
  name: editableActivityFields.name,
  description: editableActivityFields.description,
  sportType: editableActivityFields.sport_type,
});
export type ActivityEditValues = z.infer<typeof activityEditSchema>;

/** Omit unchanged fields, but retain an intentional empty description. */
export function activityEditCommand(
  original: ActivityEditValues,
  draft: unknown,
) {
  const values = activityEditSchema.parse(draft);
  return updateActivityRequestSchema.parse({
    ...(values.name !== original.name ? { name: values.name } : {}),
    ...(values.description !== original.description
      ? { description: values.description }
      : {}),
    ...(values.sportType !== original.sportType
      ? { sport_type: values.sportType }
      : {}),
  });
}
