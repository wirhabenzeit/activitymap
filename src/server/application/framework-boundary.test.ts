import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Structural check for the acceptance criterion in issue #120:
 * "Application services do not import React, `next/headers`, Server Action
 * (`"use server"`), or Route Handler APIs."
 *
 * This is a plain source-text scan, not a bundler/type-level check - that is
 * enough to catch a service reaching for a request-global or a framework
 * directive directly, which is the mistake this rule guards against. It
 * intentionally does not chase transitive dependencies (e.g. calling
 * `getAccountInternal`, which itself imports `next/headers` for its own
 * optional session-fallback branch): the rule is about what application
 * services *do themselves*, not their full module graph.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

const FORBIDDEN_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: '"use server" directive', pattern: /['"]use server['"]/ },
  { label: '"use client" directive', pattern: /['"]use client['"]/ },
  { label: "import from 'next/headers'", pattern: /from ['"]next\/headers['"]/ },
  { label: "import from 'next/server'", pattern: /from ['"]next\/server['"]/ },
  { label: "import from 'next/navigation'", pattern: /from ['"]next\/navigation['"]/ },
  { label: "import from 'react'", pattern: /from ['"]react['"]/ },
  { label: "import from 'react-dom'", pattern: /from ['"]react-dom['"]/ },
];

/**
 * Strip block comments before scanning so a doc comment that merely
 * *discusses* a forbidden API (e.g. explaining why one isn't imported) does
 * not trip the check. Real directives/imports are code, not comments, so
 * this cannot hide an actual violation.
 */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
}

const applicationDir = path.join(repoRoot, 'src/server/application');
const repositoriesDir = path.join(repoRoot, 'src/server/repositories');

const filesToCheck = [
  ...listSourceFiles(applicationDir).map((name) => path.join(applicationDir, name)),
  ...listSourceFiles(repositoriesDir).map((name) => path.join(repositoriesDir, name)),
];

void test('application services and repositories have no framework-layer imports', () => {
  assert.ok(
    filesToCheck.length > 0,
    'expected to find application/repository source files to check',
  );

  const violations: string[] = [];

  for (const filePath of filesToCheck) {
    const source = stripBlockComments(readFileSync(filePath, 'utf8'));
    for (const { label, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(repoRoot, filePath)}: ${label}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `application/repository files must not reference framework APIs directly:\n${violations.join('\n')}`,
  );
});

void test('application service files exist for the extracted use cases', () => {
  const expected = ['activities.ts', 'sync.ts'];
  const actual = listSourceFiles(applicationDir);
  for (const name of expected) {
    assert.ok(
      actual.includes(name),
      `expected ~/server/application/${name} to exist`,
    );
  }
});
