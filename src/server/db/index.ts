import * as schema from './schema';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import { config } from 'dotenv';
import ws from 'ws';

config({ path: '.env' }); // or .env.local

let sql;
console.log('process.env', process.env);
if (process.env.VERCEL_ENV === 'development') {
  console.log('Using localtest.me');
  const connectionString =
    'postgres://postgres:postgres@db.localtest.me:5432/main';
  neonConfig.fetchEndpoint = (host) => {
    const [protocol, port] =
      host === 'db.localtest.me' ? ['http', 4444] : ['https', 443];
    return `${protocol}://${host}:${port}/sql`;
  };
  const connectionStringUrl = new URL(connectionString);
  neonConfig.useSecureWebSocket =
    connectionStringUrl.hostname !== 'db.localtest.me';
  neonConfig.wsProxy = (host) =>
    host === 'db.localtest.me' ? `${host}:4444/v2` : `${host}/v2`;
  neonConfig.webSocketConstructor = ws;
  sql = neon(connectionString);
} else {
  console.log('Using DATABASE_URL');
  sql = neon(process.env.DATABASE_URL!);
}
export const db = drizzle({ client: sql, schema });
//console.log(await db.query.sessions.findFirst(), 'QUERRRRY');
