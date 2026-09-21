import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Enforced redaction (issue #127): `~/server/logging/logger.ts` is the one
 * place credential/PII redaction (`redact.ts`) is applied, and every server
 * log call is supposed to go through it rather than a bare `console.*` -
 * but until now that was only a convention documented in comments, not
 * something CI could fail on. This test scans the server-side API surface
 * for bare `console.debug/log/warn/error` calls outside `logger.ts` itself,
 * so a future call site that bypasses redaction (and would otherwise only
 * be caught by a careful reviewer) fails the build instead.
 *
 * Scope is deliberately `src/server` and the API route tree
 * (`src/app/api`), not all of `src/app` - client components legitimately
 * use the browser console for local debugging, and never handle the
 * credential/PII shapes `redact.ts` guards against. It is a regression
 * guard on the current, already-clean state, not a claim that *no* code
 * anywhere in the repository could leak a secret through some other means.
 */
const SCAN_ROOTS = ['src/server', 'src/app/api'];
const REPO_ROOT = join(__dirname, '..', '..', '..');

// The logger module itself is the one legitimate call site.
const ALLOWED_FILES = new Set([join(REPO_ROOT, 'src/server/logging/logger.ts')]);

const CONSOLE_CALL_PATTERN = /\bconsole\s*\.\s*(log|error|warn|debug|info|trace)\s*\(/;

function collectTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules') continue;
      collectTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
}

void test('no bare console.* calls outside the logger module in src/server or src/app/api', () => {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    collectTsFiles(join(REPO_ROOT, root), files);
  }
  assert.ok(files.length > 50, 'expected the scan to find a substantial number of files');

  const offenders: string[] = [];
  for (const file of files) {
    if (ALLOWED_FILES.has(file)) continue;
    const contents = readFileSync(file, 'utf8');
    if (CONSOLE_CALL_PATTERN.test(contents)) {
      offenders.push(file.slice(REPO_ROOT.length + 1));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `bare console.* call(s) found outside ~/server/logging/logger.ts - use \`logger\` from '~/server/logging/logger' instead so redaction is applied: ${offenders.join(', ')}`,
  );
});
