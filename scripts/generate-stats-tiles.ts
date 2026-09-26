#!/usr/bin/env -S tsx

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repositoryRoot, 'shared/stats-tiles.json');
const fixturesDirectory = resolve(repositoryRoot, 'shared/stats-fixtures');
const typescriptOutputPath = resolve(
  repositoryRoot,
  'src/settings/stats-tiles.generated.ts',
);
const swiftOutputPath = resolve(
  repositoryRoot,
  'ios/ActivityMap/ActivityMap/Stats/SharedStatsTiles.generated.swift',
);

const identifierSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/);
const metricIDs = ['count', 'distance', 'elevation', 'time'] as const;
const windowIDs = [
  'currentWeek',
  'yearToDate',
  'currentYear',
  'monthToDate',
  'last12Weeks',
  'last52Weeks',
  'last12Months',
  'allTime',
] as const;
const toggleOptionSchema = z.enum([...metricIDs, ...windowIDs, 'sport']);

const gridSchema = z
  .object({
    columns: z.number().int().positive(),
    rowHeight: z.number().positive(),
  })
  .strict();

const manifestSchema = z
  .object({
    version: z.literal(1),
    layout: z
      .object({
        regular: gridSchema
          .extend({ minWidth: z.number().positive() })
          .strict(),
        compact: gridSchema,
        gap: z.number().nonnegative(),
      })
      .strict(),
    metrics: z
      .object(
        Object.fromEntries(
          metricIDs.map((id) => [
            id,
            z.object({ label: z.string().min(1), unit: z.string() }).strict(),
          ]),
        ) as Record<
          (typeof metricIDs)[number],
          z.ZodObject<{ label: z.ZodString; unit: z.ZodString }>
        >,
      )
      .strict(),
    groups: z
      .array(
        z.object({ id: identifierSchema, title: z.string().min(1) }).strict(),
      )
      .min(1),
    tiles: z
      .array(
        z
          .object({
            id: identifierSchema,
            title: z.string().min(1),
            window: z.enum(windowIDs),
            group: identifierSchema,
            span: z
              .object({
                columns: z.number().int().positive(),
                rows: z.number().int().positive(),
              })
              .strict(),
            // Primary tiles get the large headline numerals.
            primary: z.boolean().optional(),
            optional: z.boolean().optional(),
            toggle: z
              .object({
                label: z.string().min(1),
                options: z.array(toggleOptionSchema).min(2),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const fixtureSchema = z
  .object({
    description: z.string().min(1),
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    activities: z
      .array(
        z
          .object({
            id: z.number().int(),
            sportType: z.string().min(1),
            startDateLocal: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
            distance: z.number().nonnegative().nullable(),
            movingTime: z.number().int().nonnegative().nullable(),
            elevationGain: z.number().nonnegative().nullable(),
          })
          .strict(),
      )
      .min(1),
    expected: z.record(identifierSchema, z.unknown()),
  })
  .strict();

const manifest = manifestSchema.parse(
  JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
);
const layout = manifest.layout;

const tileIDs = manifest.tiles.map((tile) => tile.id);
const duplicateTile = tileIDs.find(
  (id, index) => tileIDs.indexOf(id) !== index,
);
if (duplicateTile) {
  throw new Error(`Stats tile ID ${duplicateTile} is used more than once.`);
}

const groupIDs = manifest.groups.map((group) => group.id);
for (const tile of manifest.tiles) {
  if (!groupIDs.includes(tile.group)) {
    throw new Error(`Stats tile ${tile.id} is in unknown group ${tile.group}.`);
  }
  if (tile.span.columns > layout.regular.columns) {
    throw new Error(
      `Stats tile ${tile.id} is wider than the regular grid (${layout.regular.columns} columns).`,
    );
  }
  const options = tile.toggle?.options ?? [];
  if (new Set(options).size !== options.length) {
    throw new Error(`Stats tile ${tile.id} repeats a toggle option.`);
  }
}

const fixtureFiles = (await readdir(fixturesDirectory))
  .filter((name) => name.endsWith('.json'))
  .sort();
if (fixtureFiles.length === 0) {
  throw new Error('shared/stats-fixtures must contain at least one fixture.');
}
for (const name of fixtureFiles) {
  const fixture = fixtureSchema.parse(
    JSON.parse(
      await readFile(resolve(fixturesDirectory, name), 'utf8'),
    ) as unknown,
  );
  const unknownTile = Object.keys(fixture.expected).find(
    (id) => !tileIDs.includes(id),
  );
  if (unknownTile) {
    throw new Error(
      `Fixture ${name} expects unknown stats tile ${unknownTile}.`,
    );
  }
  const activityIDs = fixture.activities.map((activity) => activity.id);
  if (new Set(activityIDs).size !== activityIDs.length) {
    throw new Error(`Fixture ${name} repeats an activity ID.`);
  }
}

const unformattedTypeScript = `// Generated by pnpm stats-tiles:generate from shared/stats-tiles.json. Do not edit by hand.

export const statsTileLayout = ${JSON.stringify(layout, null, 2)} as const;

export const statsMetrics = ${JSON.stringify(manifest.metrics, null, 2)} as const;

export const statsTileGroups = ${JSON.stringify(manifest.groups, null, 2)} as const;

export const statsTiles = ${JSON.stringify(manifest.tiles, null, 2)} as const;

export type StatsMetric = keyof typeof statsMetrics;
export type StatsTile = (typeof statsTiles)[number];
export type StatsTileID = StatsTile['id'];
export type StatsTileGroupID = (typeof statsTileGroups)[number]['id'];
`;

// Format like the rest of src/ so pnpm prettier leaves the file alone.
const generatedTypeScript = await format(unformattedTypeScript, {
  ...(await resolveConfig(typescriptOutputPath)),
  filepath: typescriptOutputPath,
});

const swiftString = (value: string): string => JSON.stringify(value);
const swiftCase = (id: string): string => `    case ${id}`;

const metricRows = metricIDs
  .map(
    (id) =>
      `        case .${id}: return .init(label: ${swiftString(manifest.metrics[id].label)}, unit: ${swiftString(manifest.metrics[id].unit)})`,
  )
  .join('\n');

const groupTitleRows = manifest.groups
  .map(
    (group) => `        case .${group.id}: return ${swiftString(group.title)}`,
  )
  .join('\n');

const optionIDs = [...toggleOptionSchema.options];

const tileRows = manifest.tiles
  .map((tile) => {
    const toggle = tile.toggle
      ? `.init(label: ${swiftString(tile.toggle.label)}, options: [${tile.toggle.options.map((option) => `.${option}`).join(', ')}])`
      : 'nil';
    return `        .init(
            id: .${tile.id},
            title: ${swiftString(tile.title)},
            window: .${tile.window},
            group: .${tile.group},
            isPrimary: ${tile.primary ?? false},
            span: .init(columns: ${tile.span.columns}, rows: ${tile.span.rows}),
            isOptional: ${tile.optional ?? false},
            toggle: ${toggle}
        )`;
  })
  .join(',\n');

const generatedSwift = `// Generated by pnpm stats-tiles:generate from shared/stats-tiles.json. Do not edit by hand.

enum StatsTileID: String, CaseIterable, Hashable, Sendable {
${tileIDs.map(swiftCase).join('\n')}
}

enum StatsMetric: String, CaseIterable, Hashable, Sendable {
${metricIDs.map(swiftCase).join('\n')}

    struct Definition: Hashable, Sendable {
        let label: String
        let unit: String
    }

    var definition: Definition {
        switch self {
${metricRows}
        }
    }
}

enum StatsTileGroup: String, CaseIterable, Hashable, Sendable {
${manifest.groups.map((group) => swiftCase(group.id)).join('\n')}

    var title: String {
        switch self {
${groupTitleRows}
        }
    }
}

enum StatsWindow: String, CaseIterable, Hashable, Sendable {
${windowIDs.map(swiftCase).join('\n')}
}

enum StatsToggleOption: String, CaseIterable, Hashable, Sendable {
${optionIDs.map(swiftCase).join('\n')}
}

struct StatsTileSpan: Hashable, Sendable {
    let columns: Int
    let rows: Int
}

struct StatsTileToggle: Hashable, Sendable {
    let label: String
    let options: [StatsToggleOption]
}

struct StatsTileDefinition: Identifiable, Hashable, Sendable {
    let id: StatsTileID
    let title: String
    let window: StatsWindow
    let group: StatsTileGroup
    let isPrimary: Bool
    let span: StatsTileSpan
    let isOptional: Bool
    let toggle: StatsTileToggle?
}

struct StatsGridDefinition: Hashable, Sendable {
    let columns: Int
    let rowHeight: Double
}

enum SharedStatsTiles {
    static let regularGrid = StatsGridDefinition(columns: ${layout.regular.columns}, rowHeight: ${layout.regular.rowHeight})
    static let regularMinWidth: Double = ${layout.regular.minWidth}
    static let compactGrid = StatsGridDefinition(columns: ${layout.compact.columns}, rowHeight: ${layout.compact.rowHeight})
    static let gap: Double = ${layout.gap}

    static let tiles: [StatsTileDefinition] = [
${tileRows}
    ]
}
`;

const outputs = [
  [typescriptOutputPath, generatedTypeScript],
  [swiftOutputPath, generatedSwift],
] as const;

if (process.argv.includes('--check')) {
  for (const [path, generated] of outputs) {
    const committed = await readFile(path, 'utf8').catch(() => '');
    if (committed !== generated) {
      throw new Error(
        `${path.slice(repositoryRoot.length + 1)} is stale. Run pnpm stats-tiles:generate.`,
      );
    }
  }
} else {
  for (const [path, generated] of outputs) {
    await writeFile(path, generated);
  }
}
