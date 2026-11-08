import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  ACTIVITY_STREAM_TYPES,
  type RawActivityStreams,
  rawActivityStreamsSchema,
} from '../../src/server/strava/streams';

export const RECORDING_CODEC = 'gzip-json-v1';
export const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
export const CHUNK_SAMPLES = 4096;
export const CHUNK_BYTES = 256 * 1024;
// Leave room for gzip overhead even when metadata is incompressible.
const CHUNK_RAW_BYTES = 240 * 1024;

type StreamType = (typeof ACTIVITY_STREAM_TYPES)[number];
type Samples = NonNullable<RawActivityStreams[StreamType]>['data'];
type Channels<T> = Partial<Record<StreamType, T>>;

export function validateRecording(input: unknown): RawActivityStreams {
  if (!rawActivityStreamsSchema.safeParse(input).success)
    throw new Error('Invalid recording');
  // Inputs come from JSON. Retain the original object so every JSON metadata
  // key survives even if the validator omits special keys from its output.
  return input as RawActivityStreams;
}

export function sha256(bytes: Uint8Array, encoding: 'hex' | 'base64' = 'hex') {
  return createHash('sha256').update(bytes).digest(encoding);
}

export function recordingJson(value: unknown) {
  const rawJson = JSON as JSON & { rawJSON(text: string): unknown };
  return JSON.stringify(value, (_key, child) =>
    Object.is(child, -0) ? rawJson.rawJSON('-0') : child,
  );
}

function json(value: unknown) {
  return Buffer.from(recordingJson(value));
}

export function encodeWhole(streams: RawActivityStreams) {
  const raw = json(streams);
  if (raw.length > MAX_RECORDING_BYTES)
    throw new Error('Recording exceeds the uncompressed byte budget');
  const file = gzipSync(raw);
  const counts: Channels<number> = {};
  for (const type of ACTIVITY_STREAM_TYPES) {
    if (streams[type]) counts[type] = streams[type].data.length;
  }
  return {
    file,
    manifest: {
      codec: RECORDING_CODEC as typeof RECORDING_CODEC,
      contentHash: sha256(raw),
      compressedBytes: file.length,
      uncompressedBytes: raw.length,
      counts,
    },
  };
}

export function decodeWhole(
  file: Uint8Array,
  manifest: ReturnType<typeof encodeWhole>['manifest'],
) {
  if (
    manifest.codec !== RECORDING_CODEC ||
    file.length !== manifest.compressedBytes
  )
    throw new Error('Unexpected recording codec or compressed size');
  const raw = gunzipSync(file, { maxOutputLength: MAX_RECORDING_BYTES });
  if (
    raw.length !== manifest.uncompressedBytes ||
    sha256(raw) !== manifest.contentHash
  )
    throw new Error('Recording checksum or uncompressed size mismatch');
  const streams = validateRecording(JSON.parse(raw.toString()));
  for (const type of ACTIVITY_STREAM_TYPES) {
    if (streams[type]?.data.length !== manifest.counts[type])
      throw new Error('Recording sample count mismatch');
  }
  return streams;
}

type Chunk = { start: number; span: number; file: Buffer };
type Chunked = { headers: Buffer[]; samples: Chunk[] };

function gzipChunk(raw: Buffer) {
  const file = gzipSync(raw);
  if (raw.length > CHUNK_RAW_BYTES || file.length > CHUNK_BYTES)
    throw new Error('Recording chunk exceeds the byte budget');
  return file;
}

function* splitSamples(
  streams: RawActivityStreams,
  start: number,
  end: number,
): Generator<Chunk> {
  const channels: Channels<Samples> = {};
  for (const type of ACTIVITY_STREAM_TYPES) {
    const data = streams[type]?.data;
    if (data && start < data.length) channels[type] = data.slice(start, end);
  }
  const raw = json(channels);
  if (raw.length > CHUNK_RAW_BYTES) {
    const midpoint = Math.floor((start + end) / 2);
    if (midpoint === start)
      throw new Error('Sample exceeds the chunk byte budget');
    yield* splitSamples(streams, start, midpoint);
    yield* splitSamples(streams, midpoint, end);
    return;
  }
  yield { start, span: end - start, file: gzipChunk(raw) };
}

export function encodeChunks(streams: RawActivityStreams): Chunked {
  const metadata: Channels<unknown> = {};
  let samples = 0;
  for (const type of ACTIVITY_STREAM_TYPES) {
    const stream = streams[type];
    if (!stream) continue;
    const { data, ...fields } = stream;
    metadata[type] = fields;
    samples = Math.max(samples, data.length);
  }
  const header = json(metadata);
  const headers = [];
  for (let offset = 0; offset < header.length; offset += CHUNK_RAW_BYTES) {
    headers.push(gzipChunk(header.subarray(offset, offset + CHUNK_RAW_BYTES)));
  }
  const chunks = [];
  for (let start = 0; start < samples; start += CHUNK_SAMPLES) {
    chunks.push(
      ...splitSamples(streams, start, Math.min(start + CHUNK_SAMPLES, samples)),
    );
  }
  return { headers, samples: chunks };
}

export function decodeChunks({ headers, samples }: Chunked) {
  const readChunk = (file: Buffer) => {
    if (file.length > CHUNK_BYTES)
      throw new Error('Compressed chunk exceeds budget');
    return gunzipSync(file, { maxOutputLength: CHUNK_RAW_BYTES });
  };
  const streams = JSON.parse(
    Buffer.concat(headers.map(readChunk)).toString(),
  ) as Channels<Record<string, unknown> & { data: Samples }>;
  for (const type of ACTIVITY_STREAM_TYPES) {
    const stream = streams[type];
    if (stream) stream.data = [];
  }
  let next = 0;
  for (const { start, span, file } of samples) {
    if (
      start !== next ||
      !Number.isInteger(span) ||
      span < 1 ||
      span > CHUNK_SAMPLES
    )
      throw new Error('Invalid chunk ordering or sample span');
    const channels = JSON.parse(
      readChunk(file).toString(),
    ) as Channels<Samples>;
    for (const type of ACTIVITY_STREAM_TYPES) {
      const data = channels[type];
      if (!data) continue;
      const stream = streams[type];
      if (
        !stream ||
        stream.data.length !== start ||
        data.length > span ||
        !data.length
      )
        throw new Error('Invalid channel range');
      for (const sample of data)
        (stream.data as (number | [number, number])[]).push(sample);
    }
    next += span;
  }
  return validateRecording(streams);
}
