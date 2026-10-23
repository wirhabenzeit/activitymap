import { resolveDatabaseConnection } from '~/server/db/connection';

/** The prototype is unavailable in deployments and against remote databases. */
export function localPlacesEnabled(environment = process.env): boolean {
  if (environment.NODE_ENV !== 'development' || environment.VERCEL)
    return false;
  const url = new URL(resolveDatabaseConnection(environment).connectionString);
  return ['127.0.0.1', 'localhost', 'db.localtest.me', '[::1]'].includes(
    url.hostname,
  );
}
