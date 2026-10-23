import { deflateSync } from 'node:zlib';

import type { OsmSource } from './osm-pbf';

// Independent tiny protobuf writer for synthetic PBF fixtures. No downloaded
// data or alternate language/toolchain is needed to exercise the reader.
export function pbfVarint(value: bigint | number): Buffer {
  let integer = BigInt(value);
  if (integer < 0n) integer = BigInt.asUintN(64, integer);
  const bytes: number[] = [];
  do {
    let byte = Number(integer & 127n);
    integer >>= 7n;
    if (integer) byte |= 128;
    bytes.push(byte);
  } while (integer);
  return Buffer.from(bytes);
}
export function pbfField(
  field: number,
  value: Buffer | string | number | bigint,
) {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.isBuffer(bytes)
    ? Buffer.concat([pbfVarint(field * 8 + 2), pbfVarint(bytes.length), bytes])
    : Buffer.concat([pbfVarint(field * 8), pbfVarint(bytes)]);
}
const zigzag = (value: bigint | number) => {
  const integer = BigInt(value);
  return integer >= 0n ? integer * 2n : -integer * 2n - 1n;
};
export function pbfFileBlock(type: string, data: Buffer, compressed = true) {
  const blob = compressed
    ? Buffer.concat([pbfField(2, data.length), pbfField(3, deflateSync(data))])
    : pbfField(1, data);
  const header = Buffer.concat([pbfField(1, type), pbfField(3, blob.length)]);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(header.length);
  return Buffer.concat([prefix, header, blob]);
}
export function createPbfFixture(
  sources: OsmSource[],
  options: {
    dense?: boolean;
    unpacked?: boolean;
    compressed?: boolean;
    dataAsOf?: string;
    requiredFeatures?: string[];
    omitMetadata?: boolean;
    latOffset?: number;
    lonOffset?: number;
  } = {},
) {
  const strings = [''];
  const sid = (text: string) => {
    let index = strings.indexOf(text);
    if (index < 0) {
      index = strings.length;
      strings.push(text);
    }
    return index;
  };
  const info = (source: OsmSource) =>
    options.omitMetadata
      ? []
      : [
          pbfField(
            4,
            Buffer.concat([
              pbfField(1, source.osm_version ?? 1),
              pbfField(
                2,
                Date.parse(source.osm_timestamp ?? '2026-10-20T00:00:00Z') /
                  1000,
              ),
            ]),
          ),
        ];
  const packed = (
    field: number,
    values: (bigint | number)[],
    signed = false,
  ) => {
    const encoded = values.map((value) => (signed ? zigzag(value) : value));
    return options.unpacked
      ? Buffer.concat(encoded.map((value) => pbfField(field, value)))
      : pbfField(field, Buffer.concat(encoded.map(pbfVarint)));
  };
  const delta = (values: (bigint | number)[]) => {
    let before = 0n;
    return values.map((value) => {
      const next = BigInt(value),
        change = next - before;
      before = next;
      return change;
    });
  };
  const coordinate = (value: number, offset: number) =>
    Math.round(value * 1e9) - offset;
  const nodes = sources.filter((source) => source.osm_type === 'node');
  const groups: Buffer[] = [];
  if (options.dense && nodes.length) {
    const keysValues = nodes.flatMap((source) => [
      ...Object.entries(source.tags).flatMap(([key, value]) => [
        sid(key),
        sid(value),
      ]),
      0,
    ]);
    groups.push(
      pbfField(
        2,
        pbfField(
          2,
          Buffer.concat([
            packed(
              1,
              delta(nodes.map((source) => BigInt(source.osm_id))),
              true,
            ),
            ...(options.omitMetadata
              ? []
              : [
                  pbfField(
                    5,
                    Buffer.concat([
                      packed(
                        1,
                        nodes.map((source) => source.osm_version ?? 1),
                      ),
                      packed(
                        2,
                        delta(
                          nodes.map(
                            (source) =>
                              Date.parse(
                                source.osm_timestamp ?? '2026-10-20T00:00:00Z',
                              ) / 1000,
                          ),
                        ),
                        true,
                      ),
                    ]),
                  ),
                ]),
            packed(
              8,
              delta(
                nodes.map((source) =>
                  coordinate(source.point!.lat, options.latOffset ?? 0),
                ),
              ),
              true,
            ),
            packed(
              9,
              delta(
                nodes.map((source) =>
                  coordinate(source.point!.lon, options.lonOffset ?? 0),
                ),
              ),
              true,
            ),
            packed(10, keysValues),
          ]),
        ),
      ),
    );
  }
  for (const source of sources) {
    if (options.dense && source.osm_type === 'node') continue;
    const entries = Object.entries(source.tags),
      keys = entries.map(([key]) => sid(key)),
      values = entries.map(([, value]) => sid(value));
    const object = [
      pbfField(
        1,
        source.osm_type === 'node'
          ? zigzag(BigInt(source.osm_id))
          : BigInt(source.osm_id),
      ),
      packed(2, keys),
      packed(3, values),
      ...info(source),
    ];
    if (source.osm_type === 'node')
      object.push(
        pbfField(
          8,
          zigzag(coordinate(source.point!.lat, options.latOffset ?? 0)),
        ),
        pbfField(
          9,
          zigzag(coordinate(source.point!.lon, options.lonOffset ?? 0)),
        ),
      );
    else if (source.osm_type === 'way')
      object.push(packed(8, delta((source.node_refs ?? []).map(BigInt)), true));
    else {
      const members = source.members ?? [];
      object.push(
        packed(
          8,
          members.map((member) => sid(member.role)),
        ),
        packed(9, delta(members.map((member) => BigInt(member.ref))), true),
        packed(
          10,
          members.map((member) =>
            ['node', 'way', 'relation'].indexOf(member.type),
          ),
        ),
      );
    }
    groups.push(
      pbfField(
        2,
        pbfField(
          source.osm_type === 'node' ? 1 : source.osm_type === 'way' ? 3 : 4,
          Buffer.concat(object),
        ),
      ),
    );
  }
  const header = Buffer.concat([
    ...(options.requiredFeatures ?? ['OsmSchema-V0.6', 'DenseNodes']).map(
      (feature) => pbfField(4, feature),
    ),
    pbfField(32, Date.parse(options.dataAsOf ?? '2026-10-23T00:00:00Z') / 1000),
  ]);
  const block = Buffer.concat([
    pbfField(1, Buffer.concat(strings.map((text) => pbfField(1, text)))),
    ...groups,
    pbfField(17, 1),
    pbfField(19, options.latOffset ?? 0),
    pbfField(20, options.lonOffset ?? 0),
  ]);
  return Buffer.concat([
    pbfFileBlock('OSMHeader', header, options.compressed),
    pbfFileBlock('OSMData', block, options.compressed),
  ]);
}
