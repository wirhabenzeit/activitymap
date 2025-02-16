import { sql } from 'drizzle-orm';
import { db } from '~/server/db';

if (!('POSTGRES_URL' in process.env))
  throw new Error('POSTGRES_URL not found on .env.development');

async function reset() {
  console.log('⏳ Resetting database...');
  const start = Date.now();

  // Drop tables
  const dropTablesQuery = sql`
    DO $$ 
    DECLARE
        r RECORD;
    BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
            EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
    END $$;`;

  // Drop enums
  const dropEnumsQuery = sql`
    DO $$ 
    DECLARE
        r RECORD;
    BEGIN
        FOR r IN (SELECT t.typname as enum_name
        FROM pg_type t 
            JOIN pg_enum e on t.oid = e.enumtypid  
            JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema()) LOOP
            EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.enum_name) || ' CASCADE';
        END LOOP;
    END $$;`;

  try {
    // Execute queries sequentially
    await db.execute(dropTablesQuery);
    console.log('Tables dropped successfully');

    await db.execute(dropEnumsQuery);
    console.log('Enums dropped successfully');

    const end = Date.now();
    console.log(`✅ Reset completed successfully in ${end - start}ms`);
  } catch (error) {
    console.error('Error during reset:', error);
    throw error;
  }
}

reset().catch((err) => {
  console.error('❌ Reset failed');
  console.error(err);
  process.exit(1);
});
