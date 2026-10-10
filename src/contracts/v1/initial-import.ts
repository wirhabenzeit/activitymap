import { z } from 'zod';

export const INITIAL_IMPORT_TARGET = 200;
export const INITIAL_IMPORT_PAGE_SIZE = 50;

export const initialImportPhaseSchema = z.enum([
  'not_started',
  'importing',
  'paused',
  'failed',
  'ready',
  'empty',
]);
/** Progress describes recent activity summaries, not detail/photo enrichment. */
export const initialImportDTOSchema = z.object({
  phase: initialImportPhaseSchema,
  importedCount: z.number().int().min(0).max(INITIAL_IMPORT_TARGET),
  target: z
    .number()
    .int()
    .min(INITIAL_IMPORT_TARGET)
    .max(INITIAL_IMPORT_TARGET),
  historyComplete: z.boolean(),
  retryAt: z.iso.datetime().nullable(),
  message: z.string().nullable(),
});
export type InitialImportDTO = z.infer<typeof initialImportDTOSchema>;
