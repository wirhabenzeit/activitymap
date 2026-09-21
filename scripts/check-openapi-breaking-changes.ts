#!/usr/bin/env -S tsx
/**
 * CI entry point for the OpenAPI breaking-change check (issue #127).
 *
 * Compares the checked-in `openapi/v1.json` as of `--base` (a git ref,
 * default `origin/main`) against the current working tree's
 * `openapi/v1.json`, and exits non-zero if `findBreakingChanges`
 * (`~/src/contracts/v1/breaking-changes.ts`) finds anything. See that
 * module's doc comment for exactly what is and is not detected.
 *
 * On a branch with no `openapi/v1.json` yet at the base ref (or when the
 * base ref itself is unavailable, e.g. a shallow checkout with no
 * `origin/main`), this prints a warning and exits `0` rather than failing
 * the build for reasons unrelated to an actual contract change.
 *
 * Usage: `tsx scripts/check-openapi-breaking-changes.ts [--base=<git-ref>]`
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  findBreakingChanges,
  type OpenApiDocumentLike,
} from '../src/contracts/v1/breaking-changes.ts';

const CURRENT_PATH = 'openapi/v1.json';

function parseBaseArg(argv: string[]): string {
  const flag = argv.find((arg) => arg.startsWith('--base='));
  return flag ? flag.slice('--base='.length) : 'origin/main';
}

function readDocumentAtRef(ref: string): OpenApiDocumentLike | null {
  try {
    const raw = execFileSync('git', ['show', `${ref}:${CURRENT_PATH}`], {
      encoding: 'utf8',
    });
    return JSON.parse(raw) as OpenApiDocumentLike;
  } catch {
    return null;
  }
}

function readCurrentDocument(): OpenApiDocumentLike {
  return JSON.parse(readFileSync(CURRENT_PATH, 'utf8')) as OpenApiDocumentLike;
}

function main(): void {
  const base = parseBaseArg(process.argv.slice(2));
  const before = readDocumentAtRef(base);
  if (!before) {
    console.warn(
      `[openapi-breaking-check] Could not read ${CURRENT_PATH} at ${base} - skipping (nothing to compare against, e.g. a new file or an unavailable ref).`,
    );
    return;
  }

  const after = readCurrentDocument();
  const findings = findBreakingChanges(before, after);

  if (findings.length === 0) {
    console.log(
      `[openapi-breaking-check] No breaking changes found comparing ${base} to the working tree's ${CURRENT_PATH}.`,
    );
    return;
  }

  console.error(
    `[openapi-breaking-check] ${findings.length} breaking change(s) found comparing ${base} to the working tree's ${CURRENT_PATH}:`,
  );
  for (const finding of findings) {
    console.error(`  - ${finding.message}`);
  }
  console.error(
    '\nSee docs/api-compatibility-and-deprecation.md for what counts as breaking and how to version around it (e.g. a new /api/v2 surface, or an additive-only change instead).',
  );
  process.exitCode = 1;
}

main();
