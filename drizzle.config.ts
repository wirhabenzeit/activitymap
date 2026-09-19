import { type Config } from 'drizzle-kit';

import * as dotenv from 'dotenv';
import {
  pooledConnectionWarning,
  resolveMigrationUrl,
} from './src/server/db/migration-url';

dotenv.config({ path: '.env', override: true });

/**
 * `generate` and `check` never open a connection, so a missing database URL
 * must not block them. We therefore fall back to an obviously-unusable
 * placeholder and let the commands that *do* connect fail on it, with the
 * guidance from `resolveMigrationUrl` already printed above the failure.
 */
function schemaToolingUrl(): string {
  try {
    const target = resolveMigrationUrl();
    const warning = pooledConnectionWarning(target);
    if (warning) console.warn(warning);
    return target.url;
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
    return 'postgres://unconfigured.invalid/unconfigured';
  }
}

export default {
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: schemaToolingUrl(),
  },
} satisfies Config;
