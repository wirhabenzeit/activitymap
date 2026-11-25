import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { ConvexHttpClient } from 'convex/browser';
import { config, parse } from 'dotenv';

config({ path: '.env.development.local', quiet: true });
config({ path: '.env', quiet: true });
const { resolveDatabaseConnection } =
  await import('../../../../src/server/db/connection.ts');
assert(
  ['localhost', '127.0.0.1', 'db.localtest.me'].includes(
    new URL(resolveDatabaseConnection(process.env).connectionString).hostname,
  ),
);
const { loadBatchPlaceCatalogue } =
  await import('../../../../src/server/repositories/batch-place-catalogue.ts');
const { createPlaceMatchingRepository } =
  await import('../../../../src/server/repositories/place-matching.ts');
const { createBatchActivityPlaceMatcher } =
  await import('../../../../src/server/application/batch-activity-places.ts');
const { SERVER_MATCHER_POLICY } =
  await import('../../../../src/server/places/matching-version.ts');
const { canonicalJson } =
  await import('../../../../src/server/places/catalogue-artifact.ts');
const repository = createPlaceMatchingRepository();
const plan = JSON.parse(
  await readFile(
    new URL('./results/full-library/plan-private.json', import.meta.url),
    'utf8',
  ),
);
const summary = JSON.parse(
  await readFile(
    new URL('./results/full-library/summary.json', import.meta.url),
    'utf8',
  ),
);
const failed = [
  ...new Set(
    Object.values(summary.modes).flatMap((m) =>
      m.results.filter((r) => !r.parity).map((r) => r.group),
    ),
  ),
];
const secrets = parse(
  await readFile(new URL('./.env.benchmark', import.meta.url)),
);
const client = new ConvexHttpClient('https://spotted-fennec-603.convex.cloud', {
  logger: false,
});
client.setAdminAuth(secrets.CONVEX_DEPLOY_KEY);
const hash = (value) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
const output = [];
for (const id of failed) {
  const group = plan.groups[id];
  const pg = await loadBatchPlaceCatalogue(undefined, {
    windows: group.windows,
  });
  const cv = await client.action('lab:tiledWindows', {
    dataset: plan.version.snapshotId,
    windows: group.windows,
    nonce: `diagnosis-${Date.now()}`,
  });
  const pm = new Map(pg.places.map((p) => [p.id, p]));
  const cm = new Map(cv.places.map((p) => [p.id, p]));
  const inside = (p) =>
    group.windows.some(
      (b) =>
        p.location.longitude >= b.west &&
        p.location.longitude <= b.east &&
        p.location.latitude >= b.south &&
        p.location.latitude <= b.north,
    );
  const missing = pg.places.filter((p) => !cm.has(p.id));
  const extra = cv.places.filter((p) => !pm.has(p.id));
  const changed = cv.places.filter(
    (p) => pm.has(p.id) && hash(p) !== hash(pm.get(p.id)),
  );
  const inputs = await repository.readInputs(
    group.activities.map((a) =>
      plan.candidates.find((c) => c.activityId === a.id),
    ),
  );
  const matcher = createBatchActivityPlaceMatcher({
    snapshot: { ...pg, places: cv.places, windows: group.windows },
    policy: SERVER_MATCHER_POLICY,
  });
  let matched = 0;
  for (const a of group.activities) {
    const c = plan.candidates.find((c) => c.activityId === a.id);
    const response = await matcher.match({
      userId: c.userId,
      activityId: c.activityId,
      input: inputs.inputs.get(c.activityId),
    });
    assert.equal(hash(response), a.hash);
    matched++;
  }
  const entry = {
    group: id,
    postgresCandidates: pg.places.length,
    convexCandidates: cv.places.length,
    missing: missing.length,
    extra: extra.length,
    metadataChanged: changed.length,
    missingInsideExactWindows: missing.filter(inside).length,
    matchParity: matched,
    missingPoints: missing.map((p) => p.location),
  };
  output.push(entry);
  console.log(JSON.stringify({ ...entry, missingPoints: undefined }));
}
await writeFile(
  new URL('./results/full-library/diagnosis-private.json', import.meta.url),
  JSON.stringify(output, null, 2),
);
process.exit(0);
