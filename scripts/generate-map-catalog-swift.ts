#!/usr/bin/env -S tsx

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(repositoryRoot, 'shared/map-catalog.json');
const swiftOutputPath = resolve(
  repositoryRoot,
  'ios/ActivityMap/ActivityMap/Map/SharedMapCatalog.generated.swift',
);

const sourceURLSchema = z
  .string()
  .min(1)
  .refine(
    (url) =>
      url.startsWith('https://') ||
      /^\/map-styles\/[A-Za-z0-9]+\.json$/.test(url),
    'must use https:// or /map-styles/<id>.json',
  )
  .refine(
    (url) => !url.includes('access_token') && !/[?&]token=/i.test(url),
    'must not contain credentials',
  );

const commonSourceFields = {
  label: z.string().min(1),
  url: sourceURLSchema,
  visible: z.boolean(),
  attribution: z.string().min(1).optional(),
};

const baseMapSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...commonSourceFields,
      type: z.literal('style'),
    })
    .strict(),
  z
    .object({
      ...commonSourceFields,
      type: z.literal('raster'),
      tileSize: z.number().int().positive(),
    })
    .strict(),
]);

const rasterOverlaySchema = z
  .object({
    label: z.string().min(1),
    url: sourceURLSchema,
    tileSize: z.number().int().positive(),
    visible: z.boolean(),
    opacity: z.number().min(0).max(1),
    attribution: z.string().min(1).optional(),
  })
  .strict();

const catalogIDSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/);
const catalogSchema = z
  .object({
    version: z.literal(1),
    baseMaps: z.record(catalogIDSchema, baseMapSchema),
    rasterOverlays: z.record(catalogIDSchema, rasterOverlaySchema),
    baseMapGroups: z.array(
      z
        .object({
          id: catalogIDSchema,
          label: z.string().min(1),
          maps: z.array(catalogIDSchema).min(1),
        })
        .strict(),
    ),
    baseMapAliases: z.record(catalogIDSchema, catalogIDSchema),
    overlayGroups: z.array(
      z
        .object({
          id: catalogIDSchema,
          label: z.string().min(1),
          overlays: z.array(catalogIDSchema).min(1),
        })
        .strict(),
    ),
  })
  .strict();

const rawCatalog: unknown = JSON.parse(await readFile(catalogPath, 'utf8'));
const catalog = catalogSchema.parse(rawCatalog);
const baseMaps = Object.entries(catalog.baseMaps);
const rasterOverlays = Object.entries(catalog.rasterOverlays);

if (baseMaps.length === 0) {
  throw new Error(
    'The shared map catalogue must contain at least one base map.',
  );
}

if (baseMaps.filter(([, baseMap]) => baseMap.visible).length !== 1) {
  throw new Error('Exactly one shared base map must be visible by default.');
}

const baseMapIDs = new Set(baseMaps.map(([id]) => id));
const duplicateID = rasterOverlays.find(([id]) => baseMapIDs.has(id));
if (duplicateID) {
  throw new Error(`Map catalogue ID ${duplicateID[0]} is used more than once.`);
}

const pickerIDs = catalog.baseMapGroups.flatMap((group) => group.maps);
if (
  new Set(pickerIDs).size !== pickerIDs.length ||
  pickerIDs.some((id) => !baseMapIDs.has(id))
) {
  throw new Error('Picker groups must contain unique catalogue IDs.');
}
for (const [alias, target] of Object.entries(catalog.baseMapAliases)) {
  if (
    !baseMapIDs.has(alias) ||
    !pickerIDs.includes(target) ||
    pickerIDs.includes(alias)
  )
    throw new Error(`Invalid base map alias: ${alias}`);
}
if (
  baseMaps.some(
    ([id]) => !pickerIDs.includes(id) && !(id in catalog.baseMapAliases),
  )
)
  throw new Error('Every base map must have a picker group or alias.');

const groupedOverlays = catalog.overlayGroups.flatMap(
  (group) => group.overlays,
);
if (
  new Set(groupedOverlays).size !== groupedOverlays.length ||
  groupedOverlays.some((id) => !(id in catalog.rasterOverlays))
)
  throw new Error('Overlay groups must contain unique overlay IDs.');

const swiftString = (value: string): string => JSON.stringify(value);
const swiftOptionalString = (value: string | undefined): string =>
  value === undefined ? 'nil' : swiftString(value);

const baseMapRows = baseMaps
  .map(([id, baseMap]) => {
    const source =
      baseMap.type === 'style'
        ? `.style(url: ${swiftString(baseMap.url)})`
        : `.raster(url: ${swiftString(baseMap.url)}, tileSize: ${baseMap.tileSize})`;

    return `        .init(
            id: ${swiftString(id)},
            label: ${swiftString(baseMap.label)},
            source: ${source},
            visibleByDefault: ${baseMap.visible},
            attribution: ${swiftOptionalString(baseMap.attribution)}
        )`;
  })
  .join(',\n');

const overlayRows = rasterOverlays
  .map(
    ([id, overlay]) => `        .init(
            id: ${swiftString(id)},
            label: ${swiftString(overlay.label)},
            url: ${swiftString(overlay.url)},
            tileSize: ${overlay.tileSize},
            visibleByDefault: ${overlay.visible},
            opacity: ${overlay.opacity},
            attribution: ${swiftOptionalString(overlay.attribution)}
        )`,
  )
  .join(',\n');

const generatedSwift = `// Generated by pnpm map-catalog:generate. Do not edit by hand.

enum SharedBaseMapSource: Hashable, Sendable {
    case style(url: String)
    case raster(url: String, tileSize: Double)
}

struct SharedBaseMapDefinition: Identifiable, Hashable, Sendable {
    let id: String
    let label: String
    let source: SharedBaseMapSource
    let visibleByDefault: Bool
    let attribution: String?
}

struct SharedRasterOverlayDefinition: Identifiable, Hashable, Sendable {
    let id: String
    let label: String
    let url: String
    let tileSize: Double
    let visibleByDefault: Bool
    let opacity: Double
    let attribution: String?
}

struct SharedBaseMapGroup: Identifiable, Sendable {
    let id: String
    let label: String
    let maps: [String]
}

struct SharedOverlayGroup: Identifiable, Sendable {
    let id: String
    let label: String
    let overlays: [String]
}

enum SharedMapCatalog {
    static let overlayGroups: [SharedOverlayGroup] = [
${catalog.overlayGroups.map((group) => `        .init(id: ${swiftString(group.id)}, label: ${swiftString(group.label)}, overlays: [${group.overlays.map(swiftString).join(', ')}])`).join(',\n')}
    ]
    static let baseMapGroups: [SharedBaseMapGroup] = [
${catalog.baseMapGroups.map((group) => `        .init(id: ${swiftString(group.id)}, label: ${swiftString(group.label)}, maps: [${group.maps.map(swiftString).join(', ')}])`).join(',\n')}
    ]
    static let baseMapAliases: [String: String] = [
${Object.entries(catalog.baseMapAliases)
  .map(
    ([alias, target]) =>
      `        ${swiftString(alias)}: ${swiftString(target)}`,
  )
  .join(',\n')}
    ]

    static let baseMaps: [SharedBaseMapDefinition] = [
${baseMapRows}
    ]

    static let rasterOverlays: [SharedRasterOverlayDefinition] = [
${overlayRows}
    ]
}
`;

if (process.argv.includes('--check')) {
  const committedSwift = await readFile(swiftOutputPath, 'utf8').catch(
    () => '',
  );
  if (committedSwift !== generatedSwift) {
    throw new Error(
      'Generated Swift map catalogue is stale. Run pnpm map-catalog:generate.',
    );
  }
} else {
  await writeFile(swiftOutputPath, generatedSwift);
}

// Keep the native bundle byte-identical to the shared web templates.
const { mkdir } = await import('node:fs/promises');
const bundleDirectory = resolve(
  repositoryRoot,
  'ios/ActivityMap/ActivityMap/MapStyles',
);
if (!process.argv.includes('--check'))
  await mkdir(bundleDirectory, { recursive: true });
for (const [id, baseMap] of baseMaps) {
  if (!baseMap.url.startsWith('/map-styles/')) continue;
  const style = await readFile(
    resolve(repositoryRoot, `shared/map-styles/generated/${id}.json`),
    'utf8',
  );
  const target = resolve(bundleDirectory, `${id}.json`);
  if (process.argv.includes('--check')) {
    if ((await readFile(target, 'utf8').catch(() => '')) !== style)
      throw new Error(`Bundled style is stale: ${id}`);
  } else await writeFile(target, style);
}
