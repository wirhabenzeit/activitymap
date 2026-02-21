import * as schema from './schema';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import { config } from 'dotenv';
import ws from 'ws';

config({ path: '.env' }); // or .env.local

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@db.localtest.me:5432/main';
const connectionStringUrl = new URL(connectionString);
const useLocalNeonProxy = connectionStringUrl.hostname === 'db.localtest.me';

let sql;
if (useLocalNeonProxy) {
  console.log('Using localtest.me');
  neonConfig.fetchEndpoint = (host) => {
    const [protocol, port] =
      host === 'db.localtest.me' ? ['http', 4444] : ['https', 443];
    return `${protocol}://${host}:${port}/sql`;
  };
  neonConfig.useSecureWebSocket =
    connectionStringUrl.hostname !== 'db.localtest.me';
  neonConfig.wsProxy = (host) =>
    host === 'db.localtest.me' ? `${host}:4444/v2` : `${host}/v2`;
  neonConfig.webSocketConstructor = ws;
  sql = neon(connectionString);
} else {
  sql = neon(connectionString);
}
export const db = drizzle({ client: sql, schema });
//console.log(await db.query.sessions.findFirst(), 'QUERRRRY');
