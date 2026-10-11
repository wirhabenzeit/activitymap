import { z } from 'zod';

export const deleteAccountRequestSchema = z.strictObject({
  confirmation: z.literal('DELETE'),
});
export const deleteAccountResultSchema = z.object({
  status: z.literal('deleted'),
});
