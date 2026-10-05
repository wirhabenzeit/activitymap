import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ingestionStatusDTOSchema } from '~/contracts/v1/ingestion-status';
import {
  coverageRows,
  coverageProgress,
  coverageSummaries,
  outcomeText,
  snapshotIsStale,
} from './presentation';

const fixtures = JSON.parse(
  readFileSync('shared/ingestion-status-fixtures.v1.json', 'utf8'),
) as { scenarios: { id: string; status: unknown }[] };
const expected = JSON.parse(
  readFileSync('shared/ingestion-client-expectations.v1.json', 'utf8'),
) as Record<string, unknown>;
for (const fixture of fixtures.scenarios) {
  void test(`settings coverage: ${fixture.id}`, () => {
    const status = ingestionStatusDTOSchema.parse(fixture.status);
    const rows = coverageRows(status);
    const summaries = coverageSummaries(status);
    assert.equal(summaries.length, 4);
    assert.equal(
      summaries[2]?.status === 'Needs attention',
      status.streams.failed > 0 || status.streams.scheduling === 'stalled',
    );
    assert.equal(
      summaries[0]?.count.includes('total unknown'),
      status.history.totalActivityCount === null,
    );

    assert.deepEqual(
      rows.map(({ title, coverage, counts, schedule, reason }) => ({
        title,
        coverage,
        counts,
        schedule,
        reason,
      })),
      expected[fixture.id],
    );
    assert.equal(
      rows[0]?.counts.includes('total not yet known'),
      status.history.totalActivityCount === null,
    );
    assert.equal(
      rows[2]?.coverage === 'Needs attention',
      status.streams.failed > 0,
    );
    for (const row of rows)
      if (row.outcome)
        assert.ok(outcomeText(row.outcome).startsWith('Last run'));
    assert.equal(
      snapshotIsStale(
        status.observedAt,
        Date.parse(status.observedAt) + 120_000,
      ),
      true,
    );
    assert.equal(
      snapshotIsStale(
        status.observedAt,
        Date.parse(status.observedAt) + 59_000,
      ),
      false,
    );
  });
}

void test('progress measures available photos separately from freshness and omits unknown totals', () => {
  const fixture = fixtures.scenarios.find((item) => item.id === 'photo-only-staleness')!;
  const status = ingestionStatusDTOSchema.parse(fixture.status);
  const summaries = coverageSummaries(status);
  assert.equal(summaries[0]!.progress, null);
  assert.equal(summaries[3]!.progress!.value, 8);
  assert.equal(status.photos.current, 6);
  assert.equal(summaries[3]!.progress!.percent, 88.8);
  delete status.photos.activitiesWithStoredPhotos;
  assert.equal(coverageSummaries(status)[3]!.progress, null);
  assert.equal(coverageProgress(0, 0), null);
  assert.equal(coverageProgress(undefined, 100), null);
  assert.equal(coverageProgress(9999, 10000)!.percent, 99.9);
  assert.equal(coverageProgress(100, 100)!.percent, 100);
});
