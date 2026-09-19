type Environment = Readonly<Record<string, string | undefined>>;

export interface PreviewMigrationEnvironment {
  MIGRATION_DATABASE_URL: string;
  MIGRATION_EXPECTED_DATABASE: string;
  MIGRATION_EXPECTED_HOST: string;
  MIGRATION_FORBIDDEN_BRANCH_ID: string;
  MIGRATION_REQUIRE_TARGET_GUARDS: 'true';
}

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for automatic Preview migrations`);
  }
  return value;
}

export function resolvePreviewMigrationEnvironment(
  environment: Environment,
): PreviewMigrationEnvironment | null {
  if (environment.VERCEL_ENV !== 'preview') return null;

  const gitBranch = required(environment, 'VERCEL_GIT_COMMIT_REF');
  const configuredProductionBranch =
    environment.MIGRATION_PRODUCTION_GIT_BRANCH?.trim();
  const productionGitBranch = configuredProductionBranch?.length
    ? configuredProductionBranch
    : 'main';
  if (gitBranch === productionGitBranch) {
    throw new Error(
      `Refusing to migrate a Preview deployment for Production branch ${productionGitBranch}`,
    );
  }

  const connectionString = required(environment, 'NEON_DATABASE_URL_UNPOOLED');
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('NEON_DATABASE_URL_UNPOOLED must be a PostgreSQL URL');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith('.neon.tech')) {
    throw new Error('Preview migrations require a Neon database endpoint');
  }
  if (hostname.includes('pooler')) {
    throw new Error('Preview migrations require the direct, unpooled endpoint');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('NEON_DATABASE_URL_UNPOOLED must include a database name');
  }

  return {
    MIGRATION_DATABASE_URL: connectionString,
    MIGRATION_EXPECTED_DATABASE: database,
    MIGRATION_EXPECTED_HOST: hostname,
    MIGRATION_FORBIDDEN_BRANCH_ID: required(
      environment,
      'MIGRATION_FORBIDDEN_BRANCH_ID',
    ),
    MIGRATION_REQUIRE_TARGET_GUARDS: 'true',
  };
}
