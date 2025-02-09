import { type Config } from 'drizzle-kit';

//import {env} from "~/env";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

let url;
if (process.env.VERCEL_ENV === 'development') {
  url = 'postgres://postgres:postgres@db.localtest.me:5432/main';
} else {
  url = process.env.POSTGRES_URL!;
}

export default {
  schema: './src/server/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url,
    //connectionString: env.POSTGRES_URL,
  },
} satisfies Config;
