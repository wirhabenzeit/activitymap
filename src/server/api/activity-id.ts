import { z } from 'zod';

export const mutationActivityIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((id) => Number.isSafeInteger(Number(id)), {
    message: 'Activity ID exceeds the server storage range',
  })
  .transform(Number);

export function parseMutationActivityId(value: string): number | null {
  const parsed = mutationActivityIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
