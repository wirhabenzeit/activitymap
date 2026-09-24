const LOCAL_DATABASE_URL =
  'postgres://postgres:postgres@db.localtest.me:5432/main';

export type DatabaseConnectionSource =
  | 'NEON_DATABASE_URL_UNPOOLED'
  | 'NEON_DATABASE_URL'
  | 'DATABASE_URL'
  | 'local-default';

type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

export function resolveDatabaseConnection(environment: DatabaseEnvironment): {
  connectionString: string;
  source: DatabaseConnectionSource;
} {
  if (environment.VERCEL_ENV === 'preview') {
    const directNeonUrl = nonEmpty(environment.NEON_DATABASE_URL_UNPOOLED);
    if (!directNeonUrl) {
      throw new Error('NEON_DATABASE_URL_UNPOOLED is required in Vercel Preview');
    }

    return {
      connectionString: directNeonUrl,
      source: 'NEON_DATABASE_URL_UNPOOLED',
    };
  }

  const managedNeonUrl = nonEmpty(environment.NEON_DATABASE_URL);
  if (managedNeonUrl) {
    return {
      connectionString: managedNeonUrl,
      source: 'NEON_DATABASE_URL',
    };
  }

  const legacyUrl = nonEmpty(environment.DATABASE_URL);
  if (legacyUrl) {
    return { connectionString: legacyUrl, source: 'DATABASE_URL' };
  }

  if (nonEmpty(environment.VERCEL)) {
    throw new Error(
      'NEON_DATABASE_URL or DATABASE_URL is required when running on Vercel',
    );
  }

  return {
    connectionString: LOCAL_DATABASE_URL,
    source: 'local-default',
  };
}
