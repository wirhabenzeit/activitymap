import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { pgTable } from 'drizzle-orm/pg-core';
import test from 'node:test';

import {
  decodeGeographyPoint,
  encodeGeographyPoint,
  geographyPoint,
} from './geography-point.ts';

const littleEndianPoint = '0101000020E610000000000000000021400000000000804740';
const bigEndianPoint = '0020000001000010E640210000000000004047800000000000';
const point = { longitude: 8.5, latitude: 47 };

void test('geography writes longitude first as an EWKT parameter', () => {
  const table = pgTable('point_mapping_test', {
    point: geographyPoint('point').notNull(),
  });
  assert.equal(table.point.getSQLType(), 'geography(Point,4326)');
  assert.equal(table.point.mapToDriverValue(point), 'SRID=4326;POINT(8.5 47)');
  assert.deepEqual(table.point.mapFromDriverValue(littleEndianPoint), point);
  assert.equal(
    encodeGeographyPoint({ longitude: -180, latitude: 90 }),
    'SRID=4326;POINT(-180 90)',
  );
});

void test('geography reads both EWKB byte orders and binary slices', () => {
  assert.deepEqual(decodeGeographyPoint(littleEndianPoint), point);
  assert.deepEqual(decodeGeographyPoint(bigEndianPoint), point);
  assert.deepEqual(decodeGeographyPoint(`\\x${littleEndianPoint}`), point);
  const padded = Buffer.from(`ffff${littleEndianPoint}ffff`, 'hex');
  assert.deepEqual(decodeGeographyPoint(padded.subarray(2, 27)), point);
});

void test('geography rejects malformed values, other geometries and SRIDs', () => {
  for (const value of [
    null,
    {},
    'POINT(8.5 47)',
    littleEndianPoint.slice(2),
    `${littleEndianPoint}00`,
    `gg${littleEndianPoint.slice(2)}`,
    `02${littleEndianPoint.slice(2)}`,
    littleEndianPoint.replace('0101000020', '0102000020'),
    littleEndianPoint.replace('0101000020', '01010000A0'),
    littleEndianPoint.replace('E6100000', '110F0000'),
    Buffer.alloc(24),
  ]) {
    assert.throws(() => decodeGeographyPoint(value));
  }
});

void test('geography rejects nonfinite and out-of-range coordinates on both boundaries', () => {
  for (const invalid of [
    { longitude: Number.NaN, latitude: 0 },
    { longitude: Number.POSITIVE_INFINITY, latitude: 0 },
    { longitude: 0, latitude: Number.NEGATIVE_INFINITY },
    { longitude: 180.01, latitude: 0 },
    { longitude: -180.01, latitude: 0 },
    { longitude: 0, latitude: 90.01 },
    { longitude: 0, latitude: -90.01 },
  ]) {
    assert.throws(() => encodeGeographyPoint(invalid));
    const encoded = Buffer.from(littleEndianPoint, 'hex');
    encoded.writeDoubleLE(invalid.longitude, 9);
    encoded.writeDoubleLE(invalid.latitude, 17);
    assert.throws(() => decodeGeographyPoint(encoded));
  }
});
