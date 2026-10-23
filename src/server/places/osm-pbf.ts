import { open } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

/** Bounded reader for current OSM PBF snapshots (raw/zlib). Schema reference:
 * https://github.com/openstreetmap/OSM-binary/tree/master/osmpbf
 * IDs stay exact through delta decoding; contributor metadata is never emitted. */
export const PBF_MAX_BLOB = 32 * 1024 * 1024;
const MAX_PACKED_VALUES = 1_000_000;
const EMPTY_TAGS: Record<string, string> = Object.freeze({});
type Integer = number | bigint;
type Value = Integer | Buffer;
type Fields = Map<number, Value[]>;
const utf8 = new TextDecoder('utf-8', { fatal: true });

class WireReader {
  position = 0;
  constructor(readonly data: Buffer) {}
  get done() {
    return this.position === this.data.length;
  }
  uint(): Integer {
    let value = 0;
    for (let index = 0; index < 10; index++) {
      const byte = this.data[this.position++];
      if (byte === undefined || (index === 9 && byte > 1))
        throw new Error('Invalid/truncated PBF varint');
      if (index < 7) {
        value += (byte & 127) * 2 ** (7 * index);
        if (byte < 128) return value;
      } else {
        let wide = BigInt(value) | (BigInt(byte & 127) << BigInt(7 * index));
        if (byte < 128) return wide;
        for (let next = index + 1; next < 10; next++) {
          const high = this.data[this.position++];
          if (high === undefined || (next === 9 && high > 1))
            throw new Error('Invalid/truncated PBF varint');
          wide |= BigInt(high & 127) << BigInt(7 * next);
          if (high < 128) return wide;
        }
        throw new Error('PBF varint exceeds uint64');
      }
    }
    throw new Error('PBF varint exceeds uint64');
  }
  bytes(length: number) {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.position + length > this.data.length
    )
      throw new Error('Truncated PBF field');
    const value = this.data.subarray(this.position, this.position + length);
    this.position += length;
    return value;
  }
}
function safe(value: Value | undefined, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' && typeof value !== 'bigint')
    throw new Error('PBF integer missing or wrong wire type');
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error('PBF numeric field exceeds safe integer range');
  return number;
}
function binary(value: Value | undefined): Buffer {
  if (!Buffer.isBuffer(value))
    throw new Error('PBF message/string missing or wrong wire type');
  return value;
}
function fields(data: Buffer): Fields {
  const reader = new WireReader(data),
    result: Fields = new Map();
  while (!reader.done) {
    const tag = safe(reader.uint()),
      field = Math.floor(tag / 8),
      wire = tag % 8;
    if (field < 1) throw new Error('Invalid PBF field number');
    let value: Value;
    if (wire === 0) value = reader.uint();
    else if (wire === 2) value = reader.bytes(safe(reader.uint()));
    else if (wire === 1 || wire === 5) {
      reader.bytes(wire === 1 ? 8 : 4);
      continue;
    } else throw new Error('Unsupported PBF wire type');
    const entries = result.get(field) ?? [];
    if (entries.length >= MAX_PACKED_VALUES)
      throw new Error('PBF field exceeds value limit');
    entries.push(value);
    result.set(field, entries);
  }
  return result;
}
function one(message: Fields, field: number): Value | undefined {
  const entries = message.get(field);
  if (entries && entries.length !== 1)
    throw new Error('Duplicate PBF singular field');
  return entries?.[0];
}
function zigzag(value: Integer): Integer {
  return typeof value === 'bigint'
    ? (value >> 1n) ^ -(value & 1n)
    : value % 2 === 0
      ? value / 2
      : -(value + 1) / 2;
}
function add(a: Integer, b: Integer): Integer {
  if (
    typeof a === 'number' &&
    typeof b === 'number' &&
    Number.isSafeInteger(a + b)
  )
    return a + b;
  return BigInt(a) + BigInt(b);
}
function packed(message: Fields, field: number, signed = false): Integer[] {
  const result: Integer[] = [];
  for (const entry of message.get(field) ?? []) {
    if (Buffer.isBuffer(entry)) {
      const reader = new WireReader(entry);
      while (!reader.done) {
        const value = reader.uint();
        result.push(signed ? zigzag(value) : value);
        if (result.length > MAX_PACKED_VALUES)
          throw new Error('PBF packed array exceeds value limit');
      }
    } else result.push(signed ? zigzag(entry) : entry);
  }
  return result;
}
function signedOffset(value: Value | undefined): number {
  if (value === undefined) return 0;
  return safe(typeof value === 'bigint' ? BigInt.asIntN(64, value) : value);
}
function aligned(length: number, ...arrays: unknown[][]) {
  if (arrays.some((array) => array.length !== length))
    throw new Error('Misaligned PBF parallel arrays');
}
function identifier(value: Integer): string {
  if (value <= 0 || BigInt(value) > 9223372036854775807n)
    throw new Error('Invalid OSM source ID');
  return value.toString();
}
function timestamp(value: Integer, granularity: number) {
  const milliseconds = safe(value) * granularity;
  if (!Number.isSafeInteger(milliseconds))
    throw new Error('Invalid OSM timestamp');
  return new Date(milliseconds).toISOString().replace('.000Z', 'Z');
}
export type OsmSource = {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: string;
  osm_version?: number;
  osm_timestamp?: string;
  tags: Record<string, string>;
  point?: { lon: number; lat: number };
  point_derivation?: 'osm_node';
  node_refs?: string[];
  members?: { type: 'node' | 'way' | 'relation'; ref: string; role: string }[];
};
export type PbfVisitor = {
  select?: (tags: Record<string, string>) => boolean;
  nodeIds?: ReadonlySet<string>;
  wayIds?: ReadonlySet<string>;
  onSource: (source: OsmSource) => void;
};
function decodeBlock(data: Buffer, visitor: PbfVisitor) {
  const block = fields(data);
  const strings = (fields(binary(one(block, 1))).get(1) ?? []).map((value) =>
    utf8.decode(binary(value)),
  );
  if (strings[0] !== '')
    throw new Error('PBF string table must start with the empty string');
  const string = (index: Integer) => {
    const value = strings[safe(index)];
    if (value === undefined) throw new Error('Invalid PBF string table index');
    return value;
  };
  const granularity = safe(one(block, 17), 100),
    dates = safe(one(block, 18), 1000);
  const latOffset = signedOffset(one(block, 19)),
    lonOffset = signedOffset(one(block, 20));
  if (granularity <= 0 || dates <= 0)
    throw new Error('Invalid PBF granularity');
  const tags = (keys: Integer[], values: Integer[]) => {
    aligned(keys.length, values);
    const pairs = keys.map(
      (key, index) => [string(key), string(values[index]!)] as const,
    );
    if (new Set(pairs.map(([key]) => key)).size !== pairs.length)
      throw new Error('Duplicate OSM tag');
    return Object.fromEntries(pairs);
  };
  const metadata = (info: Value | undefined) => {
    if (info === undefined) return {};
    const values = fields(binary(info));
    if (safe(one(values, 6), 1) !== 1)
      throw new Error('Deleted objects are not a current snapshot');
    return {
      ...(one(values, 1) === undefined
        ? {}
        : { osm_version: safe(one(values, 1)) }),
      ...(one(values, 2) === undefined
        ? {}
        : { osm_timestamp: timestamp(safe(one(values, 2)), dates) }),
    };
  };
  const point = (lat: Integer, lon: Integer) => ({
    lon: (lonOffset + safe(lon) * granularity) / 1e9,
    lat: (latOffset + safe(lat) * granularity) / 1e9,
  });
  for (const groupValue of block.get(2) ?? []) {
    const group = fields(binary(groupValue));
    if (group.has(5))
      throw new Error('Changesets are not supported in a current snapshot');
    for (const value of visitor.select || visitor.nodeIds?.size
      ? (group.get(1) ?? [])
      : []) {
      const node = fields(binary(value)),
        id = identifier(zigzag(safeOrWide(one(node, 1))));
      const nodeTags = tags(packed(node, 2), packed(node, 3));
      if (!visitor.nodeIds?.has(id) && !visitor.select?.(nodeTags)) continue;
      visitor.onSource({
        osm_type: 'node',
        osm_id: id,
        tags: nodeTags,
        ...metadata(one(node, 4)),
        point: point(
          zigzag(safeOrWide(one(node, 8))),
          zigzag(safeOrWide(one(node, 9))),
        ),
        point_derivation: 'osm_node',
      });
    }
    const denseValue = one(group, 2);
    if (denseValue !== undefined && (visitor.select || visitor.nodeIds?.size)) {
      const dense = fields(binary(denseValue));
      const ids = packed(dense, 1, true),
        lats = packed(dense, 8, true),
        lons = packed(dense, 9, true),
        keyValues = packed(dense, 10);
      aligned(ids.length, lats, lons);
      const infoValue = one(dense, 5),
        info =
          infoValue === undefined
            ? new Map<number, Value[]>()
            : fields(binary(infoValue));
      const versions = packed(info, 1),
        times = packed(info, 2, true),
        visible = packed(info, 6);
      for (const column of [versions, times, visible])
        if (column.length && column.length !== ids.length)
          throw new Error('Misaligned dense PBF metadata');
      let id: Integer = 0,
        lat: Integer = 0,
        lon: Integer = 0,
        time: Integer = 0,
        tagIndex = 0;
      for (let index = 0; index < ids.length; index++) {
        id = add(id, ids[index]!);
        lat = add(lat, lats[index]!);
        lon = add(lon, lons[index]!);
        if (times.length) time = add(time, times[index]!);
        if (visible.length && visible[index] !== 1)
          throw new Error('Deleted objects are not a current snapshot');
        let nodeTags = EMPTY_TAGS;
        if (keyValues.length) {
          if (keyValues[tagIndex] !== 0) {
            const keys: Integer[] = [],
              values: Integer[] = [];
            while (keyValues[tagIndex] !== 0) {
              if (tagIndex + 1 >= keyValues.length)
                throw new Error('Unterminated dense PBF tags');
              keys.push(keyValues[tagIndex++]!);
              values.push(keyValues[tagIndex++]!);
            }
            nodeTags = tags(keys, values);
          }
          tagIndex++;
        }
        // Avoid allocating source records or ISO timestamps for millions of
        // tagless nodes. Dependency passes retain only requested node IDs.
        if (!visitor.select?.(nodeTags) && !visitor.nodeIds?.has(id.toString()))
          continue;
        visitor.onSource({
          osm_type: 'node',
          osm_id: identifier(id),
          tags: nodeTags,
          ...(versions.length ? { osm_version: safe(versions[index]) } : {}),
          ...(times.length ? { osm_timestamp: timestamp(time, dates) } : {}),
          point: point(lat, lon),
          point_derivation: 'osm_node',
        });
      }
      if (tagIndex !== keyValues.length)
        throw new Error('Extra dense PBF tags');
    }
    for (const [field, type] of [
      [3, 'way'],
      [4, 'relation'],
    ] as const) {
      if (!visitor.select && !(type === 'way' && visitor.wayIds?.size))
        continue;
      for (const value of group.get(field) ?? []) {
        const object = fields(binary(value)),
          id = identifier(safeOrWide(one(object, 1)));
        const objectTags = tags(packed(object, 2), packed(object, 3));
        if (
          !(type === 'way' && visitor.wayIds?.has(id)) &&
          !visitor.select?.(objectTags)
        )
          continue;
        const source: OsmSource = {
          osm_type: type,
          osm_id: id,
          tags: objectTags,
          ...metadata(one(object, 4)),
        };
        let reference: Integer = 0;
        if (type === 'way')
          source.node_refs = packed(object, 8, true).map((delta) =>
            identifier((reference = add(reference, delta))),
          );
        else {
          const roles = packed(object, 8),
            refs = packed(object, 9, true),
            types = packed(object, 10);
          aligned(refs.length, roles, types);
          source.members = refs.map((delta, index) => {
            const memberType = (['node', 'way', 'relation'] as const)[
              safe(types[index])
            ];
            if (!memberType)
              throw new Error('Invalid OSM relation member type');
            return {
              type: memberType,
              ref: identifier((reference = add(reference, delta))),
              role: string(roles[index]!),
            };
          });
        }
        visitor.onSource(source);
      }
    }
  }
}
function safeOrWide(value: Value | undefined): Integer {
  if (typeof value !== 'number' && typeof value !== 'bigint')
    throw new Error('Missing PBF integer');
  return value;
}

/** Stream one bounded file block at a time, applying synchronous callbacks.
 * Unknown required features/compression, history files and truncated input fail
 * closed; preparation cannot silently treat an incomplete extract as complete. */
export async function scanPbf(
  path: string,
  visitor: PbfVisitor,
): Promise<{ dataAsOf: string; blocks: number }> {
  const file = await open(path, 'r');
  let dataAsOf: string | undefined,
    blocks = 0;
  async function read(length: number, eof = false) {
    const result = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await file.read(
        result,
        offset,
        length - offset,
        null,
      );
      if (!bytesRead) {
        if (eof && offset === 0) return null;
        throw new Error('Truncated PBF file block');
      }
      offset += bytesRead;
    }
    return result;
  }
  try {
    while (true) {
      const prefix = await read(4, true);
      if (!prefix) break;
      const headerLength = prefix.readUInt32BE();
      if (headerLength < 1 || headerLength >= 64 * 1024)
        throw new Error('Invalid PBF blob header size');
      const header = fields((await read(headerLength))!);
      const type = utf8.decode(binary(one(header, 1))),
        size = safe(one(header, 3));
      if (size < 1 || size > PBF_MAX_BLOB)
        throw new Error('PBF blob exceeds size limit');
      const blob = fields((await read(size))!);
      const raw = one(blob, 1),
        compressed = one(blob, 3),
        expectedSize = one(blob, 2);
      if (
        (raw === undefined) === (compressed === undefined) ||
        [4, 5, 6, 7].some((field) => blob.has(field))
      )
        throw new Error('Unsupported PBF blob compression');
      if (
        expectedSize !== undefined &&
        (safe(expectedSize) < 0 || safe(expectedSize) > PBF_MAX_BLOB)
      )
        throw new Error('Invalid PBF decompressed size');
      const data =
        raw === undefined
          ? inflateSync(binary(compressed), { maxOutputLength: PBF_MAX_BLOB })
          : binary(raw);
      if (
        data.length > PBF_MAX_BLOB ||
        (expectedSize !== undefined && data.length !== safe(expectedSize))
      )
        throw new Error('PBF raw size mismatch');
      if (type === 'OSMHeader') {
        if (dataAsOf || blocks)
          throw new Error('Duplicate or misplaced OSM header');
        const values = fields(data),
          required = (values.get(4) ?? []).map((entry) =>
            utf8.decode(binary(entry)),
          );
        if (
          !required.includes('OsmSchema-V0.6') ||
          required.some(
            (feature) => !['OsmSchema-V0.6', 'DenseNodes'].includes(feature),
          )
        )
          throw new Error(
            'Unsupported PBF required feature (current snapshots only)',
          );
        dataAsOf = timestamp(safe(one(values, 32)), 1000);
      } else if (type === 'OSMData' && dataAsOf) {
        decodeBlock(data, visitor);
        blocks++;
      } else
        throw new Error('Unsupported PBF file block or missing OSM header');
    }
    if (!dataAsOf || !blocks)
      throw new Error('PBF snapshot has no header/data');
    return { dataAsOf, blocks };
  } finally {
    await file.close();
  }
}
