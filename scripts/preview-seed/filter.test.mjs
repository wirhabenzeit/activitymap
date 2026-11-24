import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'node:test';

import {
  filterSnapshot,
  schemaTableNames,
  stripCredentials,
  strippedAuthRecord,
} from './filter.mjs';

const schemaTables = schemaTableNames(
  await readFile(
    join(import.meta.dirname, '../../backend/convex/schema.ts'),
    'utf8',
  ),
);

async function snapshot(t, tables, files = []) {
  const directory = await mkdtemp(join(tmpdir(), 'preview-seed-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = [];
  for (const [name, rows] of Object.entries(tables)) {
    index.push({ name, id: index.length + 1 });
    await mkdir(join(directory, name));
    await writeFile(
      join(directory, name, 'documents.jsonl'),
      rows.map((row) => JSON.stringify(row) + '\n').join(''),
    );
  }
  await mkdir(join(directory, '_tables'));
  await writeFile(
    join(directory, '_tables', 'documents.jsonl'),
    index.map((row) => JSON.stringify(row) + '\n').join(''),
  );
  await mkdir(join(directory, '_storage'));
  await writeFile(
    join(directory, '_storage', 'documents.jsonl'),
    files.map((id) => JSON.stringify({ _id: id }) + '\n').join(''),
  );
  for (const id of files)
    await writeFile(join(directory, '_storage', `${id}.gz`), id);
  return directory;
}

const rows = async (directory, table) =>
  (await readFile(join(directory, table, 'documents.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

void test('credential fields are removed at any depth', () => {
  assert.deepEqual(
    stripCredentials({
      accountId: '1',
      token: 't',
      doc: {
        accessToken: 'a',
        refresh_token: 'r',
        expires_at: 1,
        accessTokenExpiresAt: 'x',
        scope: 'read',
      },
    }),
    { accountId: '1', doc: { scope: 'read' } },
  );
});

void test('float spellings survive filtering and stripping', () => {
  assert.equal(
    strippedAuthRecord(
      '{"_creationTime":1.5,"doc":{"athlete_id":100.0,"accessToken":"t"}}',
    ),
    '{"_creationTime":1.5,"doc":{"athlete_id":100.0}}',
  );
});

void test('a snapshot keeps only the chosen athletes and no credentials', async (t) => {
  const directory = await snapshot(
    t,
    {
      owners: [
        { _id: 'o1', userId: 'u1', athleteId: '100' },
        { _id: 'o2', userId: 'u2', athleteId: '200' },
      ],
      activities: [
        { _id: 'a1', owner: 'o1' },
        { _id: 'a2', owner: 'o2' },
      ],
      recordings: [
        { _id: 'r1', activity: 'a1', file: 'f1' },
        { _id: 'r2', activity: 'a2', file: 'f2' },
      ],
      ownerStats: [
        { _id: 's1', owner: 'o1' },
        { _id: 's2', owner: 'o2' },
      ],
      placeCatalogues: [{ _id: 'c1', metadata: 'f3' }],
      places: [{ _id: 'p1' }],
      livePlaces: [{ _id: 'q1' }],
      placeCatalogueState: [
        { _id: 't1', metadata: 'f5', pending: { metadata: 'f6' } },
      ],
      placeTileChanges: [{ _id: 'g1', revision: 1, tile: '1,1' }],
      activityPlaceTiles: [
        { _id: 'h1', owner: 'o1', activity: '1', tile: '1,1' },
        { _id: 'h2', owner: 'o2', activity: '2', tile: '1,1' },
      ],
      authRecords: [
        { _id: 'x1', model: 'user', key: 'u1', doc: { athlete_id: 100 } },
        { _id: 'x2', model: 'user', key: 'u2', doc: { athlete_id: 200 } },
        {
          _id: 'x3',
          model: 'account',
          key: 'k1',
          userId: 'u1',
          accountId: '100',
          doc: { accessToken: 'secret', refreshToken: 'secret', scope: 'read' },
        },
        {
          _id: 'x4',
          model: 'session',
          key: 's',
          userId: 'u1',
          token: 'secret',
        },
        { _id: 'x5', model: 'jwks', key: 'j', doc: { privateKey: 'secret' } },
      ],
      shareLinks: [{ _id: 'l1', owner: 'o1', tokenHash: 'h' }],
      shadowMatches: [{ _id: 'm1' }],
    },
    ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
  );

  const { counts } = await filterSnapshot(directory, {
    athleteIds: ['100'],
    schemaTables,
  });

  assert.deepEqual(
    (await rows(directory, 'owners')).map((r) => r._id),
    ['o1'],
  );
  assert.deepEqual(
    (await rows(directory, 'activities')).map((r) => r._id),
    ['a1'],
  );
  assert.deepEqual(
    (await rows(directory, 'recordings')).map((r) => r._id),
    ['r1'],
  );
  assert.deepEqual(
    (await rows(directory, 'ownerStats')).map((r) => r._id),
    ['s1'],
  );
  assert.equal((await rows(directory, 'places')).length, 1);
  assert.equal((await rows(directory, 'livePlaces')).length, 1);
  assert.equal((await rows(directory, 'placeCatalogueState')).length, 1);
  assert.deepEqual(await rows(directory, 'placeTileChanges'), []);
  assert.deepEqual(
    (await rows(directory, 'activityPlaceTiles')).map((r) => r._id),
    ['h1'],
  );
  assert.deepEqual(await rows(directory, 'shareLinks'), []);
  const auth = await rows(directory, 'authRecords');
  assert.deepEqual(
    auth.map((r) => r._id),
    ['x1', 'x3'],
  );
  assert.doesNotMatch(JSON.stringify(auth), /secret/);
  assert.equal(counts.shadowMatches, 'removed (not in schema)');
  assert.deepEqual((await readdir(join(directory, '_storage'))).sort(), [
    'documents.jsonl',
    'f1.gz',
    'f3.gz',
    'f5.gz',
    'f6.gz',
  ]);
  assert.deepEqual(
    (await rows(directory, '_storage')).map((r) => r._id).sort(),
    ['f1', 'f3', 'f5', 'f6'],
  );
  assert.ok(
    !(await rows(directory, '_tables')).some((r) => r.name === 'shadowMatches'),
  );
});

void test('a table without a seeding rule stops the seed', async (t) => {
  const directory = await snapshot(t, { owners: [] });
  await assert.rejects(
    filterSnapshot(directory, {
      athleteIds: ['1'],
      schemaTables: new Set([...schemaTables, 'newTable']),
    }),
    /newTable has no Preview seeding rule/,
  );
});
