import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
let files;
if (args[0] === '--base') {
  if (args.length !== 2)
    throw new Error('Usage: pnpm format:check --base <git-ref>');
  // The diff is relative to the PR's actual base, including stacked branches.
  const base = execFileSync('git', ['merge-base', 'HEAD', args[1]], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  files = git('diff', '--name-only', '--diff-filter=ACMR', '-z', base);
} else if (args.length) {
  files = args;
} else {
  files = [
    ...git('diff', '--name-only', '--diff-filter=ACMR', '-z', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard', '-z'),
  ];
}
files = [...new Set(files)].filter((file) => existsSync(resolve(root, file)));
if (!files.length) {
  console.log(
    'No changed files to format-check. Use --base <ref> to check committed work.',
  );
} else {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('prettier/bin/prettier.cjs'),
      '--check',
      '--ignore-unknown',
      '--',
      ...files,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
