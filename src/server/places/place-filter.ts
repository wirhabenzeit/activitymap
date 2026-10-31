import { metresPerDegree } from './terrain';
import type { NormalizedPlace, PlaceHiddenReason, PlaceKind } from './types';

/**
 * Catalogue noise rules for issue #462: lowland road crossings tagged as
 * passes, small bumps tagged as peaks, and Alm huts or restaurants tagged as
 * alpine huts. Hidden places stay in the catalogue with their metrics but are
 * never read as candidates. Thresholds were fitted on the Swiss and Austrian
 * gazetteer decisions of the prominence research; change them only with a new
 * version, which changes the catalogue identity and so rematches activities.
 */
export const PLACE_FILTER_POLICY = Object.freeze({
  version: 'places-filter-v1',
  /** Wikipedia or Wikidata keeps any place (Ornpass has only Wikidata). */
  notableTags: Object.freeze(['wikipedia', 'wikidata']),
  /** Names that are only an elevation label or a generic word. */
  genericPassName:
    '^(?:(?:q|quota|p|pt|pkt|punkt|cota|kote)\\.?\\s*)?\\d{3,4}(?:\\s*m)?$|^(?:sea|pass|passo|sattel|col|colle|forcella|bocchetta|joch)$',
  /** OSM `ele`, else DEM height. */
  passMinElevationM: 1_200,
  passMinAmpM: 60,
  /** Same-name passes this close are one pass: duplicate nodes must agree. */
  passMergeDistanceM: 1_000,
  peakMinProminenceM: 30,
  hutClubOperator:
    'SAC|CAS|DAV|ÖAV|OeAV|Alpenverein|CAI|Club Alpino|AVS|Naturfreunde|SAT|Alpenclub|Alpine Club|SEM|SAF',
  hutInfoTags: Object.freeze([
    'capacity',
    'beds',
    'website',
    'contact:website',
    'url',
    'wikidata',
    'wikipedia',
    'reservation',
    'opening_hours',
    'phone',
    'contact:phone',
  ]),
  /** Alm, farm, restaurant, inn, forestry, hunting and private huts. */
  hutNonMountainName:
    '(?<![\\p{L}\\p{N}_])alm(?![\\p{L}\\p{N}_])|alm$|(?<![\\p{L}\\p{N}_])alpe?(?![\\p{L}\\p{N}_])|^alp |malga|casera|baita|forst|forestal|forestière|jagd|caccia|ristoro|gasthaus|gasthof|albergo|restaurant|stadel|privat',
});

const genericPassName = new RegExp(PLACE_FILTER_POLICY.genericPassName, 'iu');
const hutClubOperator = new RegExp(PLACE_FILTER_POLICY.hutClubOperator, 'iu');
const hutNonMountainName = new RegExp(
  PLACE_FILTER_POLICY.hutNonMountainName,
  'iu',
);

type FilterInput = Pick<
  NormalizedPlace,
  | 'kinds'
  | 'display_name'
  | 'tags'
  | 'elevation_m'
  | 'dem_elevation_m'
  | 'pass_amp_m'
  | 'peak_prominence_m'
  | 'peak_prominence_capped'
>;

const hasTag = (place: FilterInput, keys: readonly string[]) =>
  keys.some((key) => !!place.tags[key]?.trim());
const notable = (place: FilterInput) =>
  hasTag(place, PLACE_FILTER_POLICY.notableTags);

/** A missing metric never hides a place: no terrain is not low terrain. */
export function passReason(place: FilterInput): PlaceHiddenReason | null {
  if (notable(place)) return null;
  if (genericPassName.test(place.display_name.trim()))
    return 'generic_pass_name';
  const elevation = place.elevation_m ?? place.dem_elevation_m;
  if (
    elevation !== undefined &&
    elevation >= PLACE_FILTER_POLICY.passMinElevationM
  )
    return null;
  if (place.pass_amp_m === undefined) return null;
  return place.pass_amp_m >= PLACE_FILTER_POLICY.passMinAmpM
    ? null
    : 'low_relief_pass';
}

export function peakReason(place: FilterInput): PlaceHiddenReason | null {
  if (
    notable(place) ||
    place.peak_prominence_m === undefined ||
    place.peak_prominence_capped
  )
    return null;
  return place.peak_prominence_m < PLACE_FILTER_POLICY.peakMinProminenceM
    ? 'low_prominence_peak'
    : null;
}

export function hutReason(place: FilterInput): PlaceHiddenReason | null {
  if (
    hutClubOperator.test(place.tags.operator ?? '') ||
    hasTag(place, PLACE_FILTER_POLICY.hutInfoTags)
  )
    return null;
  return hutNonMountainName.test(place.display_name)
    ? 'non_mountain_hut'
    : null;
}

const rules: Record<
  PlaceKind,
  (place: FilterInput) => PlaceHiddenReason | null
> = { peak: peakReason, pass: passReason, hut: hutReason };

/** Single-link groups of same-name passes within the merge distance. */
export function passGroups(
  places: readonly Pick<
    NormalizedPlace,
    'kinds' | 'display_name' | 'location'
  >[],
): number[][] {
  const byName = new Map<string, number[]>();
  places.forEach((place, index) => {
    if (!place.kinds.includes('pass')) return;
    const name = place.display_name.normalize('NFC').trim().toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), index]);
  });
  const groups: number[][] = [];
  for (const members of byName.values()) {
    const parent = members.map((_, index) => index);
    const root = (index: number): number =>
      parent[index] === index ? index : (parent[index] = root(parent[index]!));
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++) {
        const p = places[members[a]!]!.location,
          q = places[members[b]!]!.location;
        const scale = metresPerDegree((p.latitude + q.latitude) / 2);
        const distance = Math.hypot(
          (p.longitude - q.longitude) * scale.x,
          (p.latitude - q.latitude) * scale.y,
        );
        if (distance <= PLACE_FILTER_POLICY.passMergeDistanceM)
          parent[root(a)] = root(b);
      }
    const clusters = new Map<number, number[]>();
    members.forEach((member, index) => {
      const key = root(index);
      clusters.set(key, [...(clusters.get(key) ?? []), member]);
    });
    groups.push(...clusters.values());
  }
  return groups;
}

/**
 * Set each place's `hidden_reason`. A place with several kinds is hidden only
 * when every kind's rule hides it. Same-name passes within 1 km are one pass:
 * if any of its nodes is kept, all are.
 */
export function applyPlaceFilter(
  rows: readonly NormalizedPlace[],
): NormalizedPlace[] {
  const reasons = rows.map((place) =>
    Object.fromEntries(place.kinds.map((kind) => [kind, rules[kind](place)])),
  ) as Partial<Record<PlaceKind, PlaceHiddenReason | null>>[];
  for (const group of passGroups(rows))
    if (group.some((index) => reasons[index]!.pass === null))
      for (const index of group) reasons[index]!.pass = null;
  return rows.map((place, index) => {
    const rest = { ...place };
    delete rest.hidden_reason;
    const byKind = place.kinds.map((kind) => reasons[index]![kind] ?? null);
    return byKind.every((reason) => reason !== null)
      ? { ...rest, hidden_reason: byKind[0]! }
      : rest;
  });
}
