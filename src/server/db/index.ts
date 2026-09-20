import * as schema from './schema';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';
import ws from 'ws';
import { logger } from '~/server/logging/logger';
import { resolveDatabaseConnection } from './connection';

config({ path: '.env' }); // or .env.local

const { connectionString, source: databaseConnectionSource } =
  resolveDatabaseConnection(process.env);
logger.info({ databaseConnectionSource, databaseDriver: 'neon-serverless' });

const connectionStringUrl = new URL(connectionString);
const useLocalNeonProxy = connectionStringUrl.hostname === 'db.localtest.me';

// Interactive transactions are required by the application repositories.
// Drizzle's neon-http adapter intentionally throws from transaction(), while
// the Neon serverless Pool uses WebSockets and supports BEGIN/COMMIT/ROLLBACK.
neonConfig.webSocketConstructor = ws;
if (useLocalNeonProxy) {
  logger.info('Using localtest.me');
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = (host) =>
    host === 'db.localtest.me' ? `${host}:4444/v2` : `${host}/v2`;
}

const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });
