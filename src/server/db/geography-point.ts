import { Buffer } from 'node:buffer';

import { customType } from 'drizzle-orm/pg-core';

import type { PlacePoint } from '~/server/places/types';

function checkedPoint(point: PlacePoint): PlacePoint {
  if (
    !Number.isFinite(point.longitude) ||
    !Number.isFinite(point.latitude) ||
    point.longitude < -180 ||
    point.longitude > 180 ||
    point.latitude < -90 ||
    point.latitude > 90
  ) {
    throw new Error('Expected a finite WGS84 longitude/latitude point');
  }
  return point;
}

/** The parameter remains data; PostGIS parses EWKT for this geography column. */
export function encodeGeographyPoint(point: PlacePoint): string {
  const { longitude, latitude } = checkedPoint(point);
  return `SRID=4326;POINT(${longitude} ${latitude})`;
}

/**
 * PostGIS's text protocol returns hexadecimal EWKB for an unregistered geography
 * OID. Validate the entire value instead of silently accepting a different SRID,
 * geometry, dimension, empty point, or coordinate order. Binary EWKB is accepted
 * too, so a driver's binary parser can preserve the same boundary contract.
 */
export function decodeGeographyPoint(value: unknown): PlacePoint {
  let bytes: Uint8Array;
  if (typeof value === 'string') {
    const hex = value.startsWith('\\x') ? value.slice(2) : value;
    if (!/^[\da-f]{50}$/i.test(hex)) {
      throw new Error('Expected hexadecimal EWKB for a WGS84 point');
    }
    bytes = Buffer.from(hex, 'hex');
  } else if (value instanceof Uint8Array) {
    bytes = value;
  } else {
    throw new Error('Expected EWKB for a WGS84 point');
  }

  if (bytes.byteLength !== 25 || (bytes[0] !== 0 && bytes[0] !== 1)) {
    throw new Error('Invalid EWKB point length or byte order');
  }
  const littleEndian = bytes[0] === 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // POINT with an explicit SRID, without Z/M or any other EWKB type flags.
  if (
    view.getUint32(1, littleEndian) !== 0x20000001 ||
    view.getUint32(5, littleEndian) !== 4326
  ) {
    throw new Error('Expected a two-dimensional EWKB point with SRID 4326');
  }
  return checkedPoint({
    longitude: view.getFloat64(9, littleEndian),
    latitude: view.getFloat64(17, littleEndian),
  });
}

export const geographyPoint = customType<{
  data: PlacePoint;
  driverData: string;
}>({
  dataType: () => 'geography(Point,4326)',
  toDriver: encodeGeographyPoint,
  fromDriver: decodeGeographyPoint,
});
