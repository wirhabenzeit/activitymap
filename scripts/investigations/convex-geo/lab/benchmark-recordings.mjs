import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { recordingJson } from './recording/codec.ts';
import { FIXTURE_SAMPLES, generateFixture } from './recording/fixtures.ts';
import { importFixture } from './recording/local.mjs';

if (process.argv[2] === '--worker') {
  const [, , , layout, directory, fixture, path] = process.argv;
  const streams = path
    ? JSON.parse(await readFile(path, 'utf8'))
    : generateFixture(FIXTURE_SAMPLES[fixture]);
  const output = await importFixture(streams, directory, layout);
  await rm(output.published, { recursive: true });
  console.log(JSON.stringify(output.measurements));
} else {
  const fromConvex = createRequire(
    createRequire(import.meta.url).resolve('convex/package.json'),
  );
  const esbuild = fromConvex('esbuild');
  const lab = fileURLToPath(new URL('.', import.meta.url));
  const { metafile } = await esbuild.build({
    absWorkingDir: lab,
    entryPoints: ['recording/processing.ts'],
    platform: 'node',
    bundle: true,
    metafile: true,
    write: false,
  });
  const runtimeInputs = Object.keys(metafile.inputs);
  assert(
    !runtimeInputs.some((input) =>
      /(?:\/node_modules\/(?:\.pnpm\/)?(?:next|drizzle-orm|postgres|server-only)[@/]|\/src\/server\/(?:db|repositories)\/)/.test(
        input,
      ),
    ),
    'Database or Next.js reached the portable Node bundle',
  );

  const run = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'activitymap-recording-'));
  const rows = [];
  try {
    const datasets = Object.entries(FIXTURE_SAMPLES).map(
      ([fixture, samples]) => ({
        source: 'synthetic',
        fixture,
        samples,
      }),
    );
    if (process.argv.includes('--local-database')) {
      const { default: postgres } = await import('postgres');
      const sql = postgres('postgres://postgres:postgres@localhost:5432/main', {
        max: 1,
      });
      let fixtures;
      try {
        fixtures = await sql.begin(
          'isolation level repeatable read read only',
          async (tx) => tx`
          WITH ranked AS (
            SELECT activity_id,
              row_number() OVER (ORDER BY jsonb_array_length(payload->'latlng'->'data'), activity_id) AS position,
              count(*) OVER () AS total
            FROM activity_streams
            WHERE invalidated_at IS NULL
              AND jsonb_typeof(payload->'latlng'->'data') = 'array'
              AND jsonb_array_length(payload->'latlng'->'data') > 0
          )
          SELECT r.position = 1 AS smallest, r.position = r.total AS largest,
                 jsonb_array_length(s.payload->'latlng'->'data') AS samples, s.payload
          FROM ranked r JOIN activity_streams s USING (activity_id)
          WHERE r.position IN (1, (r.total + 1) / 2, r.total)
          ORDER BY r.position
        `,
        );
      } finally {
        await sql.end();
      }
      assert.equal(fixtures.length, 3, 'Expected three local recordings');
      for (const row of fixtures) {
        const fixture = row.smallest
          ? 'small'
          : row.largest
            ? 'largest'
            : 'median';
        const path = join(directory, `local-${fixture}.json`);
        await writeFile(path, recordingJson(row.payload), { mode: 0o600 });
        datasets.push({
          source: 'local-recordings',
          fixture,
          samples: row.samples,
          path,
        });
      }
    }
    const repeats = 3;
    for (const { source, fixture, samples, path } of datasets) {
      for (const layout of ['whole', 'chunks']) {
        const trials = [];
        for (let i = 0; i < repeats; i++) {
          // Each layout/trial gets a fresh process so process peak RSS resets.
          const { stdout } = await run(
            process.execPath,
            [
              '--import',
              'tsx',
              fileURLToPath(import.meta.url),
              '--worker',
              layout,
              directory,
              fixture,
              ...(path ? [path] : []),
            ],
            { cwd: lab },
          );
          trials.push(JSON.parse(stdout));
        }
        rows.push({ source, fixture, samples, layout, trials });
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const report = {
    environment: { node: process.version, platform: platform(), arch: arch() },
    evidence: 'local-filesystem',
    portableRuntimeInputCount: runtimeInputs.length,
    rows,
  };
  const destination = new URL('./results/', import.meta.url);
  await mkdir(destination, { recursive: true });
  await writeFile(
    new URL('recording-storage-local.json', destination),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `Recorded ${rows.length} dataset/layout measurements. Private source files removed.`,
  );
}
