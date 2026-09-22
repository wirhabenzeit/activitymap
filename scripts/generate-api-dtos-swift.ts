#!/usr/bin/env -S tsx

/**
 * Generates the Swift wire types the iOS client decodes, from the same Zod
 * schemas the Route Handlers validate against.
 *
 * The chain is Zod -> JSON Schema -> Swift, using the identical
 * `z.toJSONSchema` projection that `src/contracts/v1/openapi.ts` uses to build
 * `openapi/v1.json`. There is therefore no hand-maintained description of the
 * contract anywhere in between, and `--check` in CI fails if the committed
 * Swift drifts from the schemas (the same arrangement as
 * `generate-map-catalog-swift.ts` and `pnpm map-catalog:check`).
 *
 * Deliberate choices, all of which favour a forward-compatible client:
 *
 *  - Types are nested in an `ActivityMapAPI` namespace because the app already
 *    has its own `Activity` and `SportType`. Wire types and view models staying
 *    visibly distinct is a feature, not an inconvenience: the mapper between
 *    them is where id/date decoding is pinned down.
 *  - `additionalProperties: false` is not enforced. Swift's `Decodable` ignores
 *    unknown keys, so an older build keeps working when the server adds a
 *    field.
 *  - JSON Schema cannot express `superRefine`, so `SyncChangeItem`'s
 *    "an upsert carries its entity, a delete carries none" rule is absent from
 *    the generated type. The sync engine enforces it; see the plan doc.
 *  - Discriminated unions become a Swift enum, and the discriminator itself is
 *    omitted from each variant struct because the case already encodes it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { authenticationDTOSchema } from '../src/contracts/v1/auth';
import { streamTypeSchema, streamFreshnessSchema, streamFetchStatusSchema, streamFailureCodeSchema,
  streamMetadataSchema, timeStreamSchema, distanceStreamSchema, latlngStreamSchema, altitudeStreamSchema,
  wattsStreamSchema, heartrateStreamSchema, rawStreamsDTOSchema, activityStreamsDTOSchema,
} from '../src/contracts/v1/activity-streams';
import {
  activityDTOSchema,
  geometryStateSchema,
  photosStateSchema,
} from '../src/contracts/v1/activity';
import { photoDTOSchema } from '../src/contracts/v1/photo';
import { currentUserDTOSchema } from '../src/contracts/v1/user';
import {
  syncBootstrapPageDTOSchema,
  syncChangeItemDTOSchema,
  syncChangesPageDTOSchema,
  syncFreshnessMetaSchema,
  syncResourceSchema,
  syncRetentionMetaSchema,
} from '../src/contracts/v1/sync';
import { errorEnvelopeSchema } from '../src/contracts/v1/error';
import {
  mobileExchangeRequestSchema,
  mobileExchangeResponseDTOSchema,
  mobileSessionDTOSchema,
  mobileSessionListDTOSchema,
  revokeSessionRequestSchema,
} from '../src/contracts/v1/mobile-auth';
import { SCHEMA_VERSION } from '../src/contracts/v1/primitives';
import { sportTypes } from '../src/server/strava/types';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swiftOutputPath = resolve(
  repositoryRoot,
  'ios/ActivityMap/ActivityMap/Networking/DTO/ActivityMapAPI.generated.swift',
);

const NAMESPACE = 'ActivityMapAPI';
const INDENT = '    ';

/**
 * Registered schemas become `$ref`s in the JSON Schema projection, so this map
 * is also what fixes the generated Swift type names. Order is the emission
 * order in the output file.
 */
const registeredSchemas: [string, z.ZodType][] = [
  ['StreamType', streamTypeSchema],
  ['StreamFreshness', streamFreshnessSchema],
  ['StreamFetchStatus', streamFetchStatusSchema],
  ['StreamFailureCode', streamFailureCodeSchema],
  ['StreamMetadata', streamMetadataSchema],
  ['TimeStream', timeStreamSchema], ['DistanceStream', distanceStreamSchema],
  ['LatlngStream', latlngStreamSchema], ['AltitudeStream', altitudeStreamSchema],
  ['WattsStream', wattsStreamSchema], ['HeartrateStream', heartrateStreamSchema],
  ['RawStreams', rawStreamsDTOSchema], ['ActivityStreams', activityStreamsDTOSchema],
  ['GeometryState', geometryStateSchema],
  ['PhotosState', photosStateSchema],
  ['SyncResource', syncResourceSchema],
  ['Authentication', authenticationDTOSchema],
  ['CurrentUser', currentUserDTOSchema],
  ['Activity', activityDTOSchema],
  ['Photo', photoDTOSchema],
  ['SyncRetentionMeta', syncRetentionMetaSchema],
  ['SyncFreshnessMeta', syncFreshnessMetaSchema],
  ['SyncChangeItem', syncChangeItemDTOSchema],
  ['SyncBootstrapPage', syncBootstrapPageDTOSchema],
  ['SyncChangesPage', syncChangesPageDTOSchema],
  ['ErrorEnvelope', errorEnvelopeSchema],
  ['MobileExchangeRequest', mobileExchangeRequestSchema],
  ['MobileExchangeResponse', mobileExchangeResponseDTOSchema],
  ['MobileSession', mobileSessionDTOSchema],
  ['MobileSessionList', mobileSessionListDTOSchema],
  ['RevokeSessionRequest', revokeSessionRequestSchema],
];

/**
 * Swift names for string enums that appear inline in a schema rather than as a
 * registered `$ref`. Keyed by the value set so the same set always produces one
 * Swift type. An inline enum with no entry here is an error rather than a
 * guessed name, so adding an enum to the contract fails loudly here.
 */
const enumKey = (values: readonly string[]): string =>
  JSON.stringify([...values].sort());

const inlineEnumNames = new Map<string, string>([
  [enumKey(['activity', 'photo']), 'EntityType'],
  [enumKey(['upsert', 'delete']), 'ChangeOperation'],
  [enumKey(['cookie', 'bearer']), 'AuthenticationMethod'],
  [enumKey(sportTypes), 'SportType'],
  [enumKey(['low', 'medium', 'high']), 'StreamResolution'],
  [enumKey(['time', 'distance']), 'StreamSeriesType'],
]);

/**
 * Swift names for objects that appear inline inside another schema rather than
 * as a registered `$ref`, keyed by `<OwningType>.<property>`. Without an entry
 * the name is derived mechanically, which is correct but often clumsy.
 */
const nestedObjectNames = new Map<string, string>([
  ['ErrorEnvelope.error', 'ErrorBody'],
]);

type JSONSchema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const capitalize = (value: string): string =>
  value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);

/**
 * Swift keywords that can legally appear as a wire field name. The contract
 * already contains one (`Activity.private`), so declarations and coding keys
 * are backtick-escaped rather than assumed safe.
 */
const swiftKeywords = new Set([
  'Any', 'Protocol', 'Self', 'Type', 'as', 'associatedtype', 'associativity',
  'break', 'case', 'catch', 'class', 'continue', 'convenience', 'default',
  'defer', 'deinit', 'didSet', 'do', 'dynamic', 'else', 'enum', 'extension',
  'fallthrough', 'false', 'fileprivate', 'final', 'for', 'func', 'get', 'guard',
  'if', 'import', 'in', 'indirect', 'infix', 'init', 'inout', 'internal', 'is',
  'lazy', 'left', 'let', 'mutating', 'nil', 'none', 'nonmutating', 'open',
  'operator', 'optional', 'override', 'postfix', 'precedence', 'prefix',
  'private', 'protocol', 'public', 'repeat', 'required', 'rethrows', 'return',
  'right', 'self', 'set', 'static', 'struct', 'subscript', 'super', 'switch',
  'throw', 'throws', 'true', 'try', 'typealias', 'unowned', 'var', 'weak',
  'where', 'while', 'willSet',
]);

const escapeSwiftIdentifier = (name: string): string =>
  swiftKeywords.has(name) ? `\`${name}\`` : name;

/**
 * `moving_time` -> `movingTime`, `unique_id` -> `uniqueID`,
 * `athleteId` -> `athleteID`. Trailing "Id" is normalized to "ID" so a
 * snake_case wire name and an already-camelCase one land on the same Swift
 * spelling.
 */
function swiftPropertyName(wireName: string): string {
  const [head, ...rest] = wireName.split('_');
  let name = (head ?? '') + rest.map(capitalize).join('');
  if (name.length > 2 && name.endsWith('Id')) {
    name = `${name.slice(0, -2)}ID`;
  }
  return name;
}

/** `refresh_required` -> `refreshRequired`, `AlpineSki` -> `alpineSki`. */
function swiftCaseName(rawValue: string): string {
  const segments = rawValue.split(/[_\-\s]+/).filter((part) => part.length > 0);
  const [head, ...rest] = segments;
  const camel = (head ?? '').replace(/^./, (c) => c.toLowerCase());
  return camel + rest.map(capitalize).join('');
}

const refName = (ref: string): string => ref.split('/').pop() ?? ref;

// ---------------------------------------------------------------------------
// JSON Schema -> Swift types
// ---------------------------------------------------------------------------

/** Enums discovered while walking, emitted after the structs that use them. */
const discoveredEnums = new Map<string, readonly string[]>();

/** Anonymous objects discovered while walking, emitted before their owner. */
type PendingNestedObject = { name: string; schema: JSONSchema; doc: string };
const pendingNestedObjects: PendingNestedObject[] = [];

function registerInlineEnum(values: readonly string[], path: string): string {
  const key = enumKey(values);
  const name = inlineEnumNames.get(key);
  if (!name) {
    throw new Error(
      `No Swift name registered for the inline enum at ${path} ` +
        `(values: ${values.join(', ')}). Add it to inlineEnumNames in ` +
        'scripts/generate-api-dtos-swift.ts.',
    );
  }
  recordEnum(name, values, path);
  return name;
}

/**
 * Queues an inline object for emission as its own named struct, since Swift has
 * no anonymous struct literals. `ErrorEnvelope.error` becomes `ErrorBody` via
 * `nestedObjectNames`; anything unlisted falls back to `<Owner><Property>`.
 */
function registerNestedObject(schema: JSONSchema, path: string): string {
  const override = nestedObjectNames.get(path);
  const [owner, property] = path.split('.');
  const name =
    override ?? `${owner ?? ''}${capitalize(swiftPropertyName(property ?? ''))}`;

  const existing = pendingNestedObjects.find((entry) => entry.name === name);
  if (!existing) {
    pendingNestedObjects.push({
      name,
      schema,
      doc: `The shape of \`${path}\`.`,
    });
  }
  return name;
}

function recordEnum(
  name: string,
  values: readonly string[],
  path: string,
): void {
  const existing = discoveredEnums.get(name);
  if (existing && enumKey(existing) !== enumKey(values)) {
    throw new Error(
      `Swift enum ${name} is used for two different value sets (at ${path}).`,
    );
  }
  discoveredEnums.set(name, values);
}

/** Splits a nullable schema into its non-null half. */
function unwrapNullable(schema: JSONSchema): {
  inner: JSONSchema;
  nullable: boolean;
} {
  const type = schema.type;
  if (Array.isArray(type) && type.includes('null')) {
    const remaining = type.filter((entry) => entry !== 'null');
    if (remaining.length !== 1) {
      throw new Error(`Unsupported multi-type schema: ${JSON.stringify(type)}`);
    }
    return { inner: { ...schema, type: remaining[0] }, nullable: true };
  }

  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const nonNull = anyOf.filter(
      (entry) => (entry as JSONSchema).type !== 'null',
    );
    const hasNull = nonNull.length !== anyOf.length;
    if (hasNull && nonNull.length === 1) {
      return { inner: nonNull[0] as JSONSchema, nullable: true };
    }
    if (!hasNull && nonNull.length === 1) {
      return { inner: nonNull[0] as JSONSchema, nullable: false };
    }
    throw new Error(`Unsupported anyOf schema: ${JSON.stringify(anyOf)}`);
  }

  return { inner: schema, nullable: false };
}

function swiftType(schema: JSONSchema, path: string): string {
  if (typeof schema.$ref === 'string') {
    return refName(schema.$ref);
  }

  if (Array.isArray(schema.enum)) {
    return registerInlineEnum(schema.enum as string[], path);
  }

  // A `const` is only reached for non-discriminator positions; the wire value
  // is still just its underlying primitive.
  if (schema.const !== undefined) {
    return typeof schema.const === 'string' ? 'String' : 'JSONValue';
  }

  switch (schema.type) {
    case 'string':
      return schema.format === 'date-time' ? 'Date' : 'String';
    case 'integer':
      return 'Int';
    case 'number':
      return 'Double';
    case 'boolean':
      return 'Bool';
    case 'array': {
      // `z.tuple([number, number])` arrives as prefixItems. Every tuple in the
      // contract is uniform, so it maps to a Swift array; the fixed length is
      // not expressible and is documented on the property instead.
      const prefixItems = schema.prefixItems;
      if (Array.isArray(prefixItems) && prefixItems.length > 0) {
        const elementTypes = new Set(
          prefixItems.map((entry) =>
            swiftType(entry as JSONSchema, `${path}[]`),
          ),
        );
        if (elementTypes.size !== 1) {
          throw new Error(
            `Unsupported heterogeneous tuple at ${path}: ${JSON.stringify(prefixItems)}`,
          );
        }
        return `[${[...elementTypes][0]}]`;
      }
      if (schema.items === undefined) {
        return '[JSONValue]';
      }
      return `[${swiftType(schema.items as JSONSchema, `${path}[]`)}]`;
    }
    case 'object': {
      // Named fields remain typed even if unknown future metadata is allowed.
      if (schema.properties) return registerNestedObject(schema, path);
      const additional = schema.additionalProperties;
      if (additional && typeof additional === 'object') {
        return `[String: ${swiftType(additional as JSONSchema, `${path}[key]`)}]`;
      }
      if (schema.properties) {
        return registerNestedObject(schema, path);
      }
      return '[String: JSONValue]';
    }
    default:
      // `z.unknown()` projects to a schema with no constraints at all.
      if (Object.keys(schema).length === 0) {
        return 'JSONValue';
      }
      throw new Error(
        `Unsupported schema at ${path}: ${JSON.stringify(schema)}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Swift emission
// ---------------------------------------------------------------------------

const CONFORMANCES = 'Codable, Hashable, Sendable';

type EmittedProperty = {
  swiftName: string;
  wireName: string;
  type: string;
  optional: boolean;
};

function collectProperties(
  schema: JSONSchema,
  typeName: string,
  skip: ReadonlySet<string> = new Set(),
): EmittedProperty[] {
  const properties = (schema.properties ?? {}) as Record<string, JSONSchema>;
  const required = new Set((schema.required as string[] | undefined) ?? []);

  return Object.entries(properties)
    .filter(([wireName]) => !skip.has(wireName))
    .map(([wireName, rawProperty]) => {
      const { inner, nullable } = unwrapNullable(rawProperty);
      const path = `${typeName}.${wireName}`;
      return {
        swiftName: swiftPropertyName(wireName),
        wireName,
        type: swiftType(inner, path),
        optional: nullable || !required.has(wireName),
      };
    });
}

function emitStruct(
  typeName: string,
  properties: EmittedProperty[],
  doc?: string,
): string {
  const lines: string[] = [];
  if (doc) lines.push(...docComment(doc, INDENT));
  lines.push(`${INDENT}struct ${typeName}: ${CONFORMANCES} {`);

  for (const property of properties) {
    const optionalMarker = property.optional ? '?' : '';
    lines.push(
      `${INDENT}${INDENT}let ${escapeSwiftIdentifier(property.swiftName)}: ${property.type}${optionalMarker}`,
    );
  }

  const remapped = properties.filter(
    (property) => property.swiftName !== property.wireName,
  );
  if (remapped.length > 0) {
    lines.push('');
    lines.push(`${INDENT}${INDENT}enum CodingKeys: String, CodingKey {`);
    for (const property of properties) {
      const name = escapeSwiftIdentifier(property.swiftName);
      const needsRaw = property.swiftName !== property.wireName;
      lines.push(
        needsRaw
          ? `${INDENT.repeat(3)}case ${name} = "${property.wireName}"`
          : `${INDENT.repeat(3)}case ${name}`,
      );
    }
    lines.push(`${INDENT}${INDENT}}`);
  }

  lines.push(`${INDENT}}`);
  return lines.join('\n');
}

function emitEnum(typeName: string, values: readonly string[]): string {
  const lines: string[] = [];
  lines.push(`${INDENT}enum ${typeName}: String, ${CONFORMANCES} {`);
  for (const value of values) {
    lines.push(
      `${INDENT}${INDENT}case ${escapeSwiftIdentifier(swiftCaseName(value))} = "${value}"`,
    );
  }
  lines.push(`${INDENT}}`);
  return lines.join('\n');
}

/**
 * Emits a discriminated union as a Swift enum plus one struct per variant. The
 * discriminator is dropped from the variant structs because the case encodes
 * it, and the custom `init(from:)` dispatches on it.
 */
function emitUnion(typeName: string, variants: JSONSchema[]): string {
  const discriminators = new Map<string, string>();
  let discriminatorKey: string | undefined;

  for (const variant of variants) {
    const properties = (variant.properties ?? {}) as Record<
      string,
      JSONSchema
    >;
    const constEntries = Object.entries(properties).filter(
      ([, property]) => typeof property.const === 'string',
    );
    if (constEntries.length !== 1) {
      throw new Error(
        `Union ${typeName} variant does not have exactly one discriminator.`,
      );
    }
    const [key, property] = constEntries[0]!;
    if (discriminatorKey && discriminatorKey !== key) {
      throw new Error(`Union ${typeName} variants disagree on discriminator.`);
    }
    discriminatorKey = key;
    discriminators.set(property.const as string, `${typeName}${capitalize(swiftCaseName(property.const as string))}`);
  }

  if (!discriminatorKey) {
    throw new Error(`Union ${typeName} has no variants.`);
  }

  const sections: string[] = [];

  for (const variant of variants) {
    const properties = variant.properties as Record<string, JSONSchema>;
    const discriminatorValue = properties[discriminatorKey]!.const as string;
    const variantName = discriminators.get(discriminatorValue)!;
    sections.push(
      emitStruct(
        variantName,
        collectProperties(variant, variantName, new Set([discriminatorKey])),
        `The \`${discriminatorValue}\` variant of \`${typeName}\`.`,
      ),
    );
  }

  const lines: string[] = [];
  lines.push(`${INDENT}enum ${typeName}: Decodable, Hashable, Sendable {`);
  for (const [value, variantName] of discriminators) {
    lines.push(`${INDENT}${INDENT}case ${swiftCaseName(value)}(${variantName})`);
  }
  lines.push('');
  lines.push(`${INDENT}${INDENT}private enum DiscriminatorKeys: String, CodingKey {`);
  lines.push(`${INDENT.repeat(3)}case ${swiftPropertyName(discriminatorKey)} = "${discriminatorKey}"`);
  lines.push(`${INDENT}${INDENT}}`);
  lines.push('');
  lines.push(`${INDENT}${INDENT}init(from decoder: any Decoder) throws {`);
  lines.push(
    `${INDENT.repeat(3)}let container = try decoder.container(keyedBy: DiscriminatorKeys.self)`,
  );
  lines.push(
    `${INDENT.repeat(3)}let discriminator = try container.decode(String.self, forKey: .${swiftPropertyName(discriminatorKey)})`,
  );
  lines.push(`${INDENT.repeat(3)}switch discriminator {`);
  for (const [value, variantName] of discriminators) {
    lines.push(`${INDENT.repeat(3)}case "${value}":`);
    lines.push(
      `${INDENT.repeat(4)}self = .${swiftCaseName(value)}(try ${variantName}(from: decoder))`,
    );
  }
  lines.push(`${INDENT.repeat(3)}default:`);
  lines.push(`${INDENT.repeat(4)}throw DecodingError.dataCorrupted(`);
  lines.push(`${INDENT.repeat(5)}DecodingError.Context(`);
  lines.push(`${INDENT.repeat(6)}codingPath: decoder.codingPath,`);
  lines.push(
    `${INDENT.repeat(6)}debugDescription: "Unknown ${typeName} ${discriminatorKey} \\(discriminator)"`,
  );
  lines.push(`${INDENT.repeat(5)})`);
  lines.push(`${INDENT.repeat(4)})`);
  lines.push(`${INDENT.repeat(3)}}`);
  lines.push(`${INDENT}${INDENT}}`);
  lines.push(`${INDENT}}`);

  sections.push(lines.join('\n'));
  return sections.join('\n\n');
}

function docComment(text: string, indent: string): string[] {
  return text
    .split('\n')
    .map((line) => `${indent}/// ${line}`.trimEnd());
}

/**
 * Runs `build`, then emits any inline objects it discovered ahead of it, so a
 * nested struct is declared before the type that refers to it. Draining in a
 * loop covers objects nested inside other nested objects.
 */
function withNestedObjects(build: () => string): string {
  const body = build();
  const nested: string[] = [];
  while (pendingNestedObjects.length > 0) {
    const entry = pendingNestedObjects.shift()!;
    nested.push(
      emitStruct(
        entry.name,
        collectProperties(entry.schema, entry.name),
        entry.doc,
      ),
    );
  }
  return [...nested, body].join('\n\n');
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const registry = z.registry<{ id: string }>();
for (const [id, schema] of registeredSchemas) {
  registry.add(schema, { id });
}

const { schemas: rawSchemas } = z.toJSONSchema(registry, {
  target: 'draft-2020-12',
  uri: (id) => `#/components/schemas/${id}`,
});

const sections: string[] = [];

for (const [id] of registeredSchemas) {
  const raw = rawSchemas[id] as JSONSchema | undefined;
  if (!raw) {
    throw new Error(`Schema ${id} is missing from the JSON Schema projection.`);
  }
  const { $id, $schema, ...schema } = raw;
  void $id;
  void $schema;

  if (Array.isArray(schema.enum)) {
    recordEnum(id, schema.enum as string[], id);
    continue;
  }

  if (Array.isArray(schema.oneOf)) {
    sections.push(
      withNestedObjects(() => emitUnion(id, schema.oneOf as JSONSchema[])),
    );
    continue;
  }

  sections.push(
    withNestedObjects(() => emitStruct(id, collectProperties(schema, id))),
  );
}

// Enums last, so the structs that reference them read first.
const enumSections = [...discoveredEnums.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, values]) => emitEnum(name, values));

const generatedSwift = `// Generated by pnpm api-dtos:generate. Do not edit by hand.
//
// Swift mirrors of the v1 wire contract in src/contracts/v1, produced from the
// same Zod schemas the Route Handlers validate against. Companion hand-written
// types (the response envelope, paged lists, JSONValue, and the decoder) live
// in APISupport.swift.
//
// Unknown JSON keys are ignored on decode, so an older build keeps working
// against a server that has added fields.
//
// Everything here is nonisolated: the target builds with
// SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor, and the sync engine decodes these
// on its own background actor.

import Foundation

nonisolated enum ${NAMESPACE} {
${INDENT}/// Matches SCHEMA_VERSION in src/contracts/v1/primitives.ts. Every v1
${INDENT}/// response carries this; anything else means the contracts have diverged.
${INDENT}static let schemaVersion = "${SCHEMA_VERSION}"
}

nonisolated extension ${NAMESPACE} {
${sections.join('\n\n')}
}

nonisolated extension ${NAMESPACE} {
${enumSections.join('\n\n')}
}
`;

if (process.argv.includes('--check')) {
  const committedSwift = await readFile(swiftOutputPath, 'utf8').catch(() => '');
  if (committedSwift !== generatedSwift) {
    throw new Error(
      'Generated Swift API DTOs are stale. Run pnpm api-dtos:generate.',
    );
  }
  console.log('Generated Swift API DTOs are up to date.');
} else {
  await writeFile(swiftOutputPath, generatedSwift);
  console.log(`Wrote ${swiftOutputPath}`);
}
