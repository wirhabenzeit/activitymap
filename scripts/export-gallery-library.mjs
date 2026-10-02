// Export activities from the local dev database for the native screenshot gallery.
//
//   node --env-file=.env scripts/export-gallery-library.mjs          # curated fixture (committed)
//   node --env-file=.env scripts/export-gallery-library.mjs --all    # full library (local cache only)
//
// The curated fixture is a hand-picked set of the repository owner's own
// activities, shared deliberately. Route ends are trimmed so start/finish
// points near home are not published; detailed polylines are dropped.
// The full library stays outside the repository for local scale checks.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import postgres from 'postgres';

// Zone-less timestamp columns must not be shifted by the machine's zone.
process.env.TZ = 'UTC';
const url = new URL(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '');
assert(['localhost', '127.0.0.1', 'db.localtest.me'].includes(url.hostname), 'Only the local Docker database is permitted');
assert.equal(url.port || '5432', '5432');
url.hostname = '127.0.0.1';

const repo = resolve(import.meta.dirname, '..');
const all = process.argv.includes('--all');
const output = all
  ? join(homedir(), 'Library/Caches/ActivityMapGallery/library.json')
  : join(repo, 'ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json');

// Mostly central Switzerland so routes overlap on the map, plus deliberate
// edge cases: no GPS (virtual ride, strength), long names, power data.
const curated = [
  '20279947341', '20270725942', '20244330171', '9763658653', '12701301525', '15539509558', '10339238562',
  '20265394210', '20211944523', '17987713656', '18076151150', '8867321894', '19458129654', '19659836135',
  '20141348300', '17073025139', '13633946082', '20253423469', '19161544374', '15760463702',
];
const trimMeters = 500;

// Columns mirror the API Activity DTO; the gallery decodes them through the
// production mapper. Streams and photos are not exported.
const columns = [
  'id', 'athlete', 'name', 'description', 'distance', 'moving_time', 'elapsed_time', 'total_elevation_gain',
  'sport_type', 'start_date', 'start_date_local', 'timezone', 'start_latlng', 'end_latlng', 'achievement_count',
  'kudos_count', 'comment_count', 'athlete_count', 'photo_count', 'total_photo_count', 'map_polyline',
  'map_summary_polyline', 'map_bbox', 'trainer', 'commute', 'manual', 'private', 'flagged', 'workout_type',
  'average_speed', 'max_speed', 'calories', 'has_heartrate', 'average_heartrate', 'max_heartrate',
  'heartrate_opt_out', 'display_hide_heartrate_option', 'elev_high', 'elev_low', 'pr_count', 'has_kudoed',
  'hide_from_home', 'device_watts', 'average_watts', 'max_watts', 'weighted_average_watts', 'kilojoules',
  'last_updated', 'geometry_state', 'photos_state', 'last_summary_seen_at', 'last_detailed_fetched_at',
];
const bigints = new Set(['id', 'athlete']);

const sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => undefined });
try {
  const [{ athlete } = {}] = await sql`select athlete::text from activities group by athlete order by count(*) desc limit 1`;
  assert(athlete, 'The local database has no activities');
  const rows = all
    ? await sql`select ${sql(columns)} from activities where athlete = ${athlete} order by start_date desc`
    : await sql`select ${sql(columns)} from activities where id in ${sql(curated)} order by start_date desc`;
  if (!all) assert.equal(rows.length, curated.length, 'Some curated activities are missing locally');
  const activities = rows.map((row) => {
    const activity = {};
    for (const column of columns) {
      let value = row[column];
      if (value === null || value === undefined) continue;
      // Wall-clock columns are stored without a zone; the API sends them UTC-shaped.
      if (value instanceof Date) value = value.toISOString();
      else if (bigints.has(column)) value = String(value);
      activity[column] = value;
    }
    return all ? activity : trimmed(activity);
  });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, all ? JSON.stringify({ activities }) : `${JSON.stringify({ activities }, null, 1)}\n`);
  const routed = activities.filter((a) => a.map_polyline || a.map_summary_polyline).length;
  console.log(`Exported ${activities.length} activities (${routed} with routes) to ${output}`);
} finally {
  await sql.end({ timeout: 5 });
}

/** Summary geometry only, without the first/last trimMeters of the route. */
function trimmed(activity) {
  const { map_polyline: _detailed, last_detailed_fetched_at: _fetched, ...rest } = activity;
  rest.geometry_state = 'summary';
  delete rest.start_latlng;
  delete rest.end_latlng;
  delete rest.map_bbox;
  if (!rest.map_summary_polyline) return rest;
  const points = decode(rest.map_summary_polyline);
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + meters(points[i - 1], points[i]));
  const total = distances.at(-1);
  const kept = points.filter((_, i) => distances[i] >= trimMeters && distances[i] <= total - trimMeters);
  if (kept.length < 2) {
    delete rest.map_summary_polyline;
    return rest;
  }
  rest.map_summary_polyline = encode(kept);
  const lats = kept.map((p) => p[0]);
  const lngs = kept.map((p) => p[1]);
  rest.start_latlng = kept[0];
  rest.end_latlng = kept.at(-1);
  rest.map_bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  return rest;
}

function meters([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

function decode(polyline) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < polyline.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, byte;
      do {
        byte = polyline.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function encode(points) {
  let output = '', lastLat = 0, lastLng = 0;
  for (const [latitude, longitude] of points) {
    const lat = Math.round(latitude * 1e5), lng = Math.round(longitude * 1e5);
    for (let value of [lat - lastLat, lng - lastLng]) {
      value = value < 0 ? ~(value << 1) : value << 1;
      while (value >= 0x20) {
        output += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
        value >>= 5;
      }
      output += String.fromCharCode(value + 63);
    }
    lastLat = lat; lastLng = lng;
  }
  return output;
}
