import { ZodError } from 'zod';

import type { RunFailure } from '~/lib/admin/job-run-summary';

export type { RunFailure };

/** Per run; the attempt tables still count every failure. */
export const MAX_RUN_FAILURES = 10;
const MAX_DETAIL_CHARS = 300;
const MAX_ZOD_ISSUES = 3;

const firstLine = (error: unknown) => {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? ` ${String(error.status)}`
      : '';
  const text =
    error instanceof Error
      ? `${error.name}${status}: ${error.message}`
      : String(error);
  return text.split('\n')[0]!.trim();
};

/**
 * A short, single-line cause: Zod issue paths and messages (never the
 * values), an HTTP status, or a wrapped database error's own message (never
 * the query parameters). Never a stack or response body.
 */
export function describeFailure(error: unknown): string {
  let text: string;
  if (error instanceof ZodError) {
    const issues = error.issues
      .slice(0, MAX_ZOD_ISSUES)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    const more = error.issues.length - MAX_ZOD_ISSUES;
    text = `ZodError: ${issues.join('; ')}${more > 0 ? ` (+${more} more)` : ''}`;
  } else if (error instanceof Error && error.cause instanceof Error) {
    // Drizzle wraps driver errors as "Failed query: <sql>"; the cause says why.
    text = `${firstLine(error.cause)} ← ${error.name}`;
  } else {
    text = firstLine(error);
  }
  return text.length > MAX_DETAIL_CHARS
    ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…`
    : text;
}

/** Appends a failure unless the run already holds `MAX_RUN_FAILURES`. */
export function addRunFailure(
  failures: RunFailure[],
  activityId: number | string | bigint,
  code: string,
  error: unknown,
) {
  if (failures.length >= MAX_RUN_FAILURES) return;
  failures.push({
    activityId: String(activityId),
    code,
    detail: describeFailure(error),
  });
}
