// Filters an extracted Convex snapshot down to what a Preview deployment may
// hold: the libraries of chosen athletes, the shared place catalogue, and
// sign-in identities without credentials. See docs/preview-strava-login.md.
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';

/** Shared reference data, copied whole. */
export const SHARED_TABLES = [
  'placeCatalogues',
  'places',
  'catalogueAdoptions',
  'livePlaces',
  'placeCatalogueState',
];

/** Per-owner library tables, filtered by their `owner` field. */
export const OWNER_TABLES = [
  'ownerHeads',
  'ownerStats',
  'placeMatchCounts',
  'ownerEpochs',
  'activities',
  'photos',
  'photoSets',
  'changes',
  'ingestionSweeps',
  'activityPlaceTiles',
];

/**
 * Tables emptied on Preview: operational state (queues, nonces, budgets,
 * rate limits, publication records and the tiles a re-match walk has left), delivered events, and
 * share links, whose tokens would grant access to production libraries from
 * Preview.
 */
export const EMPTIED_TABLES = [
  'providerEvents',
  'ingestionJobs',
  'shareLinks',
  'rateLimits',
  'providerBudget',
  'bridgeNonces',
  'placeTileChanges',
  // Its walk progress belongs to the tiles above.
  'placePublications',
];

/** Auth models that identify a person; sessions, verifications and keys are
 * never copied. */
const AUTH_MODELS = new Set(['user', 'account']);

/** Credential fields removed from copied auth records. */
const CREDENTIAL_KEY = /token|secret|password|^expires_?at$/i;

export function stripCredentials(value) {
  if (Array.isArray(value)) return value.map(stripCredentials);
  if (!value || typeof value !== 'object' || JSON.isRawJSON(value))
    return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !CREDENTIAL_KEY.test(key))
      .map(([key, inner]) => [key, stripCredentials(inner)]),
  );
}

/** The stored files a shared table's document refers to: the manifest and
 * coverage of a rowset, and of the live catalogue's completed and pending
 * publications. */
const SHARED_FILES = {
  placeCatalogues: (row) => [row.metadata],
  placeCatalogueState: (row) => [row.metadata, row.pending?.metadata],
};

/** The table names a Convex schema source defines. */
export const schemaTableNames = (source) =>
  new Set(
    [...source.matchAll(/^ {2}(\w+): defineTable\(/gm)].map(
      (match) => match[1],
    ),
  );

/** The decision for one document of a table, given what was kept so far. */
export function keepDocument(table, document, kept) {
  if (SHARED_TABLES.includes(table)) return document;
  if (table === 'owners')
    return kept.athletes.has(String(document.athleteId)) ? document : null;
  if (OWNER_TABLES.includes(table))
    return kept.owners.has(document.owner) ? document : null;
  if (table === 'recordings')
    return kept.activities.has(document.activity) ? document : null;
  if (table === 'authRecords') {
    if (!AUTH_MODELS.has(document.model)) return null;
    const userId =
      document.model === 'user' ? document.key : (document.userId ?? null);
    return userId && kept.users.has(userId) ? document : null;
  }
  return null;
}

/**
 * Convex exports a float64 with an integral value as `24300.0`; written back
 * as `24300` it would import as an int64 and fail schema validation. Kept
 * rows are therefore copied as their original text, and a row that must be
 * changed keeps each number's original spelling.
 */
const preserveNumbers = (_key, value, context) =>
  typeof value === 'number' ? JSON.rawJSON(context.source) : value;

/** Removes credentials from an auth record, keeping its number spellings. */
export const strippedAuthRecord = (line) =>
  JSON.stringify(stripCredentials(JSON.parse(line, preserveNumbers)));

async function* lines(path) {
  const input = createReadStream(path, 'utf8');
  for await (const line of createInterface({ input, crlfDelay: Infinity }))
    if (line.trim()) yield { line, document: JSON.parse(line) };
}

async function filterTable(directory, table, kept, onKeep) {
  const source = join(directory, table, 'documents.jsonl');
  const target = `${source}.filtered`;
  const output = createWriteStream(target);
  let count = 0;
  for await (const { line, document } of lines(source)) {
    if (!keepDocument(table, document, kept)) continue;
    onKeep?.(document);
    count++;
    const text = table === 'authRecords' ? strippedAuthRecord(line) : line;
    if (!output.write(text + '\n'))
      await new Promise((resolve) => output.once('drain', resolve));
  }
  output.end();
  await finished(output);
  await rename(target, source);
  return count;
}

async function empty(directory, table) {
  const output = createWriteStream(join(directory, table, 'documents.jsonl'));
  output.end();
  await finished(output);
}

/**
 * Filters the snapshot in `directory` in place and returns per-table counts.
 * Tables the current schema does not define are removed, so an import with
 * `--replace-all` leaves Preview with exactly the filtered data.
 */
export async function filterSnapshot(directory, { athleteIds, schemaTables }) {
  const kept = {
    athletes: new Set(athleteIds.map(String)),
    owners: new Set(),
    users: new Set(),
    activities: new Set(),
    files: new Set(),
  };
  if (!kept.athletes.size) throw new Error('No athlete IDs to keep');
  const present = new Set(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name),
  );
  const counts = {};
  const run = async (table, onKeep) => {
    if (!present.has(table)) return;
    counts[table] = await filterTable(directory, table, kept, onKeep);
  };

  // Order matters: owners decide users and owner rows, activities decide
  // recordings, and recordings and catalogues decide stored files.
  await run('owners', (owner) => {
    kept.owners.add(owner._id);
    kept.users.add(owner.userId);
  });
  for (const table of OWNER_TABLES)
    await run(
      table,
      table === 'activities'
        ? (activity) => kept.activities.add(activity._id)
        : undefined,
    );
  await run('recordings', (recording) => kept.files.add(recording.file));
  for (const table of SHARED_TABLES)
    await run(
      table,
      SHARED_FILES[table] &&
        ((row) => {
          for (const file of SHARED_FILES[table](row))
            if (file) kept.files.add(file);
        }),
    );
  await run('authRecords');
  for (const table of EMPTIED_TABLES) {
    if (!present.has(table) || !schemaTables.has(table)) continue;
    await empty(directory, table);
    counts[table] = 0;
  }

  for (const table of present)
    if (!schemaTables.has(table)) {
      await rm(join(directory, table), { recursive: true });
      counts[table] = 'removed (not in schema)';
    }
  const handled = new Set([
    'owners',
    'recordings',
    'authRecords',
    ...OWNER_TABLES,
    ...SHARED_TABLES,
    ...EMPTIED_TABLES,
  ]);
  for (const table of schemaTables)
    if (!handled.has(table))
      throw new Error(
        `Table ${table} has no Preview seeding rule; add it to scripts/preview-seed/filter.mjs`,
      );

  counts._storage = await filterStorage(directory, kept.files);
  await rewriteTableIndex(directory);
  return { counts, kept };
}

/** Keeps the stored files the kept documents reference, by `_id`; file
 * names are the storage ID plus an extension. */
async function filterStorage(directory, files) {
  const storage = join(directory, '_storage');
  let entries;
  try {
    entries = await readdir(storage);
  } catch {
    return 0;
  }
  const source = join(storage, 'documents.jsonl');
  const target = `${source}.filtered`;
  const output = createWriteStream(target);
  let kept = 0;
  for await (const { line, document } of lines(source)) {
    if (!files.has(document._id)) continue;
    kept++;
    output.write(line + '\n');
  }
  output.end();
  await finished(output);
  await rename(target, source);
  for (const entry of entries) {
    if (entry === 'documents.jsonl') continue;
    if (!files.has(entry.replace(/\..*$/, ''))) await rm(join(storage, entry));
  }
  return kept;
}

async function rewriteTableIndex(directory) {
  const path = join(directory, '_tables', 'documents.jsonl');
  const present = new Set(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const rows = (await readFile(path, 'utf8'))
    .split('\n')
    .filter((line) => line && present.has(JSON.parse(line).name));
  const output = createWriteStream(path);
  for (const line of rows) output.write(line + '\n');
  output.end();
  await finished(output);
}
