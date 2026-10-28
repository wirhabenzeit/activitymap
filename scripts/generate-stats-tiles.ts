#!/usr/bin/env -S tsx

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

import {
  statsCapabilitiesSchema,
  statsParitySchema,
} from './lib/stats-parity-schema';

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
  'last90Days',
  'last12Months',
  'allTime',
] as const;
const placeKindIDs = ['peak', 'pass', 'hut'] as const;
const toggleOptionSchema = z.enum([
  ...metricIDs,
  ...windowIDs,
  'sport',
  ...placeKindIDs,
]);

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
        compact: gridSchema
          .extend({ minWidth: z.number().positive() })
          .strict(),
        narrow: gridSchema,
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
            // Web card minimum in CSS pixels; native layout remains intrinsic.
            minHeight: z.number().positive().optional(),
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
const capabilities = statsCapabilitiesSchema.parse(
  JSON.parse(
    await readFile(
      resolve(repositoryRoot, 'shared/stats-capabilities.v1.json'),
      'utf8',
    ),
  ),
);
statsParitySchema.parse(
  JSON.parse(
    await readFile(
      resolve(repositoryRoot, 'shared/stats-parity-fixtures.v1.json'),
      'utf8',
    ),
  ),
);
if (
  new Set(capabilities.tiles.map((tile) => tile.id)).size !==
    manifest.tiles.length ||
  capabilities.tiles.length !== manifest.tiles.length
)
  throw new Error(
    'Stats capabilities must cover each manifest tile exactly once.',
  );
for (const tile of capabilities.tiles) {
  const declared = manifest.tiles.find((candidate) => candidate.id === tile.id);
  if (
    declared?.group !== tile.group ||
    JSON.stringify(declared?.toggle?.options ?? []) !==
      JSON.stringify(tile.options) ||
    tile.defaultOption !== (declared?.toggle?.options[0] ?? null)
  )
    throw new Error(`Stats capability ${tile.id} disagrees with the manifest.`);
}
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

// Every generated title has a checked presentation message, never a cached English copy.
const presentationCatalog = JSON.parse(
  await readFile(
    resolve(repositoryRoot, 'shared/presentation/catalog.v1.json'),
    'utf8',
  ),
) as { messages: Record<string, { source: string }> };
const localized = (id: string, source: string) => {
  if (presentationCatalog.messages[id]?.source !== source)
    throw new Error(`Stats message ${id} differs from its manifest source.`);
  return `message('${id}')`;
};
const localizedMetrics = `{${Object.entries(manifest.metrics)
  .map(
    ([id, metric]) =>
      `${JSON.stringify(id)}: {label: ${localized(`stats.metric.${id}`, metric.label)}, unit: ${JSON.stringify(metric.unit)}}`,
  )
  .join(',')}}`;
const localizedGroups = `[${manifest.groups.map((group) => `{id: ${JSON.stringify(group.id)}, title: ${localized(`stats.group.${group.id}`, group.title)}}`).join(',')}]`;
const localizedTiles = `[${manifest.tiles
  .map((tile) => {
    let value = JSON.stringify(tile).replace(
      `"title":${JSON.stringify(tile.title)}`,
      `"title":${localized(`stats.tile.${tile.id}`, tile.title)}`,
    );
    if (tile.toggle)
      value = value.replace(
        `"label":${JSON.stringify(tile.toggle.label)}`,
        `"label":${localized(`stats.toggle.${tile.id}`, tile.toggle.label)}`,
      );
    return value;
  })
  .join(',')}]`;

const unformattedTypeScript = `// Generated by pnpm stats-tiles:generate from shared/stats-tiles.json. Do not edit by hand.

import { message } from '~/lib/presentation/messages';

export const statsTileLayout = ${JSON.stringify(layout, null, 2)} as const;

export const statsMetrics = ${localizedMetrics} as const;

export const statsTileGroups = ${localizedGroups} as const;

export const statsTiles = ${localizedTiles} as const;

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
const messageSymbol = (id: string) =>
  id.replace(/[._]([a-z])/g, (_, c: string) => c.toUpperCase());
const tileTitleRows = manifest.tiles
  .map(
    (tile) =>
      `        case .${tile.id}: AppMessages.${messageSymbol(`stats.tile.${tile.id}`)}(locale: locale)`,
  )
  .join('\n');

const metricRows = metricIDs
  .map(
    (id) =>
      `        case .${id}: return .init(label: String(localized: AppMessages.${messageSymbol(`stats.metric.${id}`)}()), unit: ${swiftString(manifest.metrics[id].unit)})`,
  )
  .join('\n');

const groupTitleRows = manifest.groups
  .map(
    (group) =>
      `        case .${group.id}: return AppMessages.${messageSymbol(`stats.group.${group.id}`)}(locale: locale)`,
  )
  .join('\n');

const optionIDs = [...toggleOptionSchema.options];

const tileRows = manifest.tiles
  .map((tile) => {
    const toggle = tile.toggle
      ? `.init(titleID: .${tile.id}, options: [${tile.toggle.options.map((option) => `.${option}`).join(', ')}])`
      : 'nil';
    return `        .init(
            id: .${tile.id},
            window: .${tile.window},
            group: .${tile.group},
            isPrimary: ${tile.primary ?? false},
            span: .init(columns: ${tile.span.columns}, rows: ${tile.span.rows}),
            minHeight: ${tile.minHeight ?? 'nil'},
            isOptional: ${tile.optional ?? false},
            toggle: ${toggle}
        )`;
  })
  .join(',\n');

const generatedSwift = `// Generated by pnpm stats-tiles:generate from shared/stats-tiles.json. Do not edit by hand.

import Foundation

enum StatsTileID: String, CaseIterable, Hashable, Sendable {
${tileIDs.map(swiftCase).join('\n')}

    func titleResource(locale: Locale = .current) -> LocalizedStringResource {
        switch self {
${tileTitleRows}
        }
    }
    func toggleResource(locale: Locale = .current) -> LocalizedStringResource {
        switch self {
${manifest.tiles
  .filter((tile) => tile.toggle)
  .map(
    (tile) =>
      `        case .${tile.id}: AppMessages.${messageSymbol(`stats.toggle.${tile.id}`)}(locale: locale)`,
  )
  .join('\n')}
        default: AppMessages.navigationStats(locale: locale)
        }
    }
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

    var title: String { String(localized: titleResource()) }
    func titleResource(locale: Locale = .current) -> LocalizedStringResource {
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
    let titleID: StatsTileID
    var label: String { String(localized: titleID.toggleResource()) }
    let options: [StatsToggleOption]
}

struct StatsTileDefinition: Identifiable, Hashable, Sendable {
    let id: StatsTileID
    var title: String { String(localized: id.titleResource()) }
    let window: StatsWindow
    let group: StatsTileGroup
    let isPrimary: Bool
    let span: StatsTileSpan
    let minHeight: Double?
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
    static let compactMinWidth: Double = ${layout.compact.minWidth}
    static let narrowGrid = StatsGridDefinition(columns: ${layout.narrow.columns}, rowHeight: ${layout.narrow.rowHeight})
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
