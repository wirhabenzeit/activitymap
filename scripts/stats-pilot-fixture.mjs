// Deterministic, explicitly synthetic mixed-sport history for chart review.
// Uses the gallery DTO shape; writes only the requested local fixture file.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const [output] = process.argv.slice(2);
assert(output, 'Pass an output JSON filename');
const sample = JSON.parse(readFileSync(new URL('../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json', import.meta.url))).activities[0];
const today = Date.UTC(2026, 8, 22);
const sports = ['Ride', 'Run', 'Hike', 'NordicSki', 'Swim'];
const activities = [];
for (let week = 0; week < 12; week++) {
  for (let sport = 0; sport < sports.length; sport++) {
    const start = today - (week * 7 + sport) * 86_400_000;
    const distance = (sport === 0 ? 30000 : sport === 4 ? 1500 : 8000) * (1 + ((week * 3 + sport) % 7) / 6);
    activities.push({ ...sample, id: String(900000 + week * 10 + sport),
      name: `Synthetic ${sports[sport]} ${week + 1}`, sport_type: sports[sport],
      start_date: new Date(start).toISOString(), start_date_local: new Date(start).toISOString(),
      distance, moving_time: Math.round(1800 + distance / 5), elapsed_time: Math.round(2100 + distance / 5),
      total_elevation_gain: sport === 4 ? 0 : Math.round(distance * (0.005 + sport * 0.008)),
      map_summary_polyline: null, map_polyline: null, start_latlng: null, end_latlng: null, map_bbox: null,
      commute: false, private: false, flagged: false });
  }
}
writeFileSync(output, JSON.stringify({ description: 'Synthetic dense Stats pilot fixture; reporting date 2026-09-22', activities }, null, 2));
console.log(`Wrote ${activities.length} synthetic activities to ${output}`);
