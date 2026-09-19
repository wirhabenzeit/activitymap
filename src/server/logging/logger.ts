import { redact } from './redact';

function withRedaction(args: unknown[]): unknown[] {
  return args.map((arg) => redact(arg));
}

/**
 * Console wrapper that redacts authorization headers, session/token values,
 * and personal activity data before anything reaches the log output.
 */
export const logger = {
  debug: (...args: unknown[]) => console.debug(...withRedaction(args)),
  info: (...args: unknown[]) => console.log(...withRedaction(args)),
  warn: (...args: unknown[]) => console.warn(...withRedaction(args)),
  error: (...args: unknown[]) => console.error(...withRedaction(args)),
};
