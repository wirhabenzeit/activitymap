import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ingestionStatusDTOSchema } from '~/contracts/v1/ingestion-status';
import {
  coverageRows,
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
