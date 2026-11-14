import { ZodError } from 'zod';

/** Diagnose wrapped failures without logging provider values or capabilities. */
export function errorDiagnostic(error: unknown, depth = 0): object {
  if (!(error instanceof Error)) return { name: 'UnknownError' };
  return {
    name: error.name,
    ...(error instanceof ZodError && {
      issues: error.issues.map(({ path, code }) => ({ path, code })),
    }),
    ...(error.cause !== undefined &&
      depth < 4 && {
        cause: errorDiagnostic(error.cause, depth + 1),
      }),
  };
}
