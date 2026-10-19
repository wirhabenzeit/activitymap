/** Kept as a compatible entry point. Canonical artwork and category metadata
 * now live in shared/presentation, without importing a React component. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL('./generate-presentation.mjs', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
