import { resolvePreviewMigrationEnvironment } from '../../src/server/db/preview-migration.ts';
import { runMigrationOperation } from './migrate.ts';

const migrationEnvironment = resolvePreviewMigrationEnvironment(process.env);

if (!migrationEnvironment) {
  console.log('Preview database migration skipped outside Vercel Preview.');
} else {
  console.log(
    `Applying Preview migrations for ${process.env.VERCEL_GIT_COMMIT_REF}.`,
  );
  await runMigrationOperation('apply', {
    ...process.env,
    ...migrationEnvironment,
    MIGRATION_EXPECTED_BRANCH_ID: undefined,
  });
}
