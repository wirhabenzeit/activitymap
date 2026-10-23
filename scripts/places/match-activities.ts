import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import postgres from 'postgres';

import {
  type ActivityMatchReport,
  runActivityPlaceMatching,
} from '../../src/server/application/activity-places';
import { verifyConnectedTarget } from '../../src/server/db/migration-tooling';
import { loadCatalogueArtifact } from '../../src/server/places/catalogue-artifact';
import { resolveCatalogueImportTarget } from '../../src/server/places/catalogue-import-target';
import {
  DEFAULT_MATCHER_POLICY,
  MATCHER_VERSION,
  parametersHash,
} from '../../src/server/places/policy';
import {
  type RunManifest,
  runManifestSchema,
} from '../../src/server/places/run-manifest';
import { createActivityPlacesRepository } from '../../src/server/repositories/activity-places';
import { createPlacesRepository } from '../../src/server/repositories/places';

async function writePrivateJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

function reportGeoJson(report: ActivityMatchReport) {
  return {
    type: 'FeatureCollection',
    features: [
      ...report.sections.map((section, index) => ({
        type: 'Feature',
        geometry: report.geometry.geometries[index],
        properties: {
          role: 'recorded_track_section',
          activity_id: report.activityId,
          section_id: section.id,
          start_gps_index: section.samples[0]?.index,
          end_gps_index: section.samples.at(-1)?.index,
        },
      })),
      ...report.candidates.map((candidate) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            candidate.location.longitude,
            candidate.location.latitude,
          ],
        },
        properties: {
          role: 'candidate_place',
          place_id: candidate.id,
          name: candidate.displayName,
          kinds: candidate.kinds,
          attribution: '© OpenStreetMap contributors',
          evidence:
            report.matches.find((match) => match.placeId === candidate.id)
              ?.evidence ?? null,
        },
      })),
    ],
  };
}

const { values } = parseArgs({
  options: {
    catalogue: { type: 'string' },
    out: { type: 'string' },
    user: { type: 'string' },
    athlete: { type: 'string' },
    activity: { type: 'string', multiple: true },
    policy: { type: 'string' },
    apply: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});

if (values.help) {
  console.log(
    `Match explicitly scoped, already stored activities in the local POC database:\n  pnpm places:match --catalogue <directory> --out <new-directory> --user <user-id> --athlete <athlete-id> --activity <activity-id> [--activity <id> ...] --policy ${MATCHER_VERSION} [--dry-run | --apply]\nDefaults to dry-run. Requires the same explicit local MIGRATION_DATABASE_URL and target guards as places:import. Never loads .env or fetches activity streams. Output contains private route evidence; use ignored output/. A fresh run directory is required. Rerun interrupted activities into a new directory.`,
  );
} else {
  if (
    !values.catalogue ||
    !values.out ||
    !values.user ||
    !values.athlete ||
    !/^[1-9][0-9]*$/.test(values.athlete) ||
    !values.activity?.length ||
    values.policy !== MATCHER_VERSION ||
    (values.apply && values['dry-run'])
  )
    throw new Error(
      'Required: --catalogue, --out, --user, --athlete, --activity and the supported --policy; choose --dry-run or --apply',
    );
  const target = resolveCatalogueImportTarget(process.env);
  const catalogue = await loadCatalogueArtifact(values.catalogue);
  const identity = {
    runId: randomUUID(),
    catalogueSnapshotId: catalogue.manifest.catalogue_snapshot_id,
    matcherVersion: MATCHER_VERSION,
    parametersHash: parametersHash(DEFAULT_MATCHER_POLICY),
  };
  const manifest: RunManifest = runManifestSchema.parse({
    ...identity,
    formatVersion: 1,
    mode: values.apply ? 'apply' : 'dry_run',
    actor: {
      userId: values.user,
      athleteId: Number(values.athlete),
      authentication: 'bearer',
    },
    activityIds: values.activity,
    records: [],
    coverageSha256: catalogue.manifest.coverage.sha256,
    createdAt: new Date().toISOString(),
    policy: DEFAULT_MATCHER_POLICY,
  });
  const output = resolve(values.out);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  await writePrivateJson(join(output, 'manifest.json'), manifest);
  // A separate reserved session holds the run mutex while other connections
  // perform short reads/publication transactions. No pooler or global DB import.
  const client = postgres(target.connectionString, {
    max: 3,
    prepare: false,
    connection: {
      search_path: 'public',
      statement_timeout: 60_000,
      lock_timeout: 10_000,
      application_name: 'activity-places-manual-run',
    },
    onnotice: () => undefined,
  });
  try {
    await verifyConnectedTarget(client, target);
    await runActivityPlaceMatching({
      actor: manifest.actor,
      activityIds: manifest.activityIds,
      catalogue,
      policy: DEFAULT_MATCHER_POLICY,
      identity,
      apply: values.apply === true,
      repositories: {
        places: createPlacesRepository(client),
        activityPlaces: createActivityPlacesRepository(client),
      },
      onReport: async (report) => {
        await writePrivateJson(
          join(output, `${report.activityId}.json`),
          report,
        );
        await writePrivateJson(
          join(output, `${report.activityId}.geojson`),
          reportGeoJson(report),
        );
      },
      onRecord: async (record) => {
        manifest.records.push(record);
        await writePrivateJson(
          join(output, 'manifest.json'),
          runManifestSchema.parse(manifest),
        );
        console.log(
          JSON.stringify({
            activity_id: record.activityId,
            outcome: record.outcome,
            published: record.published,
            matches: record.matchCount,
          }),
        );
      },
    });
    manifest.finishedAt = new Date().toISOString();
    await writePrivateJson(
      join(output, 'manifest.json'),
      runManifestSchema.parse(manifest),
    );
    console.log(
      JSON.stringify({
        run_id: identity.runId,
        mode: manifest.mode,
        output,
        activities: manifest.records.length,
      }),
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}
