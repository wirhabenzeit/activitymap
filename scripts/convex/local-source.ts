/**
 * Shared setup for operator scripts that read the LOCAL development Postgres
 * and talk to the Convex application backend (`backend/`).
 *
 * The app's database module picks its connection from the environment and
 * `.env`. These scripts pin that resolution to the local database and refuse
 * to run if anything (for example a Neon URL in `.env`) would win instead.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import { config } from 'dotenv';

import { resolveDatabaseConnection } from '../../src/server/db/connection';

const LOCAL_DATABASE_URL =
  'postgres://postgres:postgres@db.localtest.me:5432/main';
const LOCAL_HOSTS = new Set(['db.localtest.me', 'localhost', '127.0.0.1']);

/** Must run before anything imports `src/server/db`. */
export function pinLocalDatabase() {
  config({ path: '.env', quiet: true });
  process.env.DATABASE_URL =
    process.env.IMPORT_DATABASE_URL ?? LOCAL_DATABASE_URL;
  const { connectionString, source } = resolveDatabaseConnection(process.env);
  const host = new URL(connectionString).hostname;
  if (source !== 'DATABASE_URL' || !LOCAL_HOSTS.has(host))
    throw new Error(
      `Refusing to read ${host} (${source}); these scripts only read the local database`,
    );
  return host;
}

export function parseArgs(argv: string[]) {
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]!;
    if (!name.startsWith('--')) throw new Error(`Unexpected argument ${name}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--'))
      options.set(name.slice(2), 'true');
    else {
      options.set(name.slice(2), value);
      i++;
    }
  }
  return options;
}

const run = promisify(execFile);

/** Retry transient network failures. Every call made through this is safe to
 * repeat: Convex writes are fenced and upload URLs are only consumed on success. */
export async function withRetry<T>(work: () => Promise<T>, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.error(
        `Retrying after attempt ${attempt} failed: ${String(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

/**
 * Runs an internal Convex function on the deployment configured in
 * `backend/.env.local` (written by `convex dev --configure`). Uses the
 * logged-in CLI, so no deploy key is needed. Arguments travel on the command
 * line, so callers keep each batch well below the OS argument limit.
 */
export async function convexRun<T>(fn: string, args: unknown): Promise<T> {
  const { stdout } = await withRetry(() =>
    run(
      'pnpm',
      [
        '--silent',
        '--dir',
        'backend',
        'exec',
        'convex',
        'run',
        fn,
        JSON.stringify(args),
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    ),
  );
  const text = stdout.trim();
  return (text === '' ? null : JSON.parse(text)) as T;
}

/** Group items into batches below a serialized byte budget and count limit. */
export function batchesOf<T>(
  items: T[],
  { maxBytes, maxItems }: { maxBytes: number; maxItems: number },
) {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (
      current.length > 0 &&
      (bytes + size > maxBytes || current.length >= maxItems)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function token() {
  return randomBytes(24).toString('base64url');
}
