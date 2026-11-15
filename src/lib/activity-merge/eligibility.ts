import type { SportType } from '~/contracts/sport';

/**
 * Which activities can be merged into one (issue: merge consecutive
 * activities). Shared by the web client, which decides whether to offer the
 * action and what the preview warns about, and the server, which rechecks
 * the same rules against what Strava says before building anything.
 *
 * Merging rebuilds one recording from the parts' streams, uploads it as a
 * new activity and leaves deleting the originals to the athlete: Strava's
 * API cannot delete activities.
 */

export const MERGE_MIN_PARTS = 2;
export const MERGE_MAX_PARTS = 5;
/** Longer breaks are almost certainly separate trips. Ultra events with a
 * night's sleep stay well inside this. */
export const MERGE_MAX_GAP_SECONDS = 24 * 3600;
/** Breaks longer than this are called out in the preview. */
export const MERGE_LONG_GAP_SECONDS = 2 * 3600;
/** One part ending this far from where the next starts is called out. */
export const MERGE_JUMP_METERS = 1000;

export type MergeCandidate = {
  id: number | string;
  name: string;
  sport_type: SportType;
  start_date: Date;
  elapsed_time: number | null;
  manual: boolean | null;
  trainer: boolean | null;
  private: boolean | null;
  map_summary_polyline: string | null;
  start_latlng: number[] | null;
  end_latlng: number[] | null;
  kudos_count: number | null;
  comment_count: number | null;
  total_photo_count?: number | null;
  photo_count?: number | null;
};

export type MergeBlocker =
  | { code: 'too_few'; min: number }
  | { code: 'too_many'; max: number }
  | { code: 'manual'; id: string }
  | { code: 'missing_time'; id: string }
  | { code: 'overlap'; first: string; second: string }
  | { code: 'gap_too_long'; after: string; seconds: number }
  | { code: 'mixed_gps' }
  | { code: 'not_consecutive'; between: string[] };

export type MergeWarning =
  | { code: 'long_gap'; after: string; seconds: number }
  | { code: 'jump'; after: string; meters: number }
  | { code: 'mixed_sports'; sports: SportType[] }
  | { code: 'private_part' }
  | { code: 'photos'; count: number }
  | { code: 'social'; kudos: number; comments: number };

export type MergeGap = {
  /** The part the break follows. */
  after: string;
  seconds: number;
  /** Straight-line distance from the end of one part to the next start. */
  meters: number | null;
};

export type MergePlan<T extends MergeCandidate> = {
  /** Parts ordered by start time. */
  parts: T[];
  gaps: MergeGap[];
  blockers: MergeBlocker[];
  warnings: MergeWarning[];
  /** The sport the merged activity gets unless the athlete picks another. */
  sport: SportType;
};

const idOf = (value: MergeCandidate) => String(value.id);
const endOf = (value: MergeCandidate) =>
  value.start_date.getTime() + (value.elapsed_time ?? 0) * 1000;

export function haversineMeters(
  [lat1, lon1]: number[],
  [lat2, lon2]: number[],
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2! - lat1!) * rad;
  const dLon = (lon2! - lon1!) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1! * rad) * Math.cos(lat2! * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const validPoint = (value: number[] | null): value is number[] =>
  !!value &&
  value.length >= 2 &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);

const hasGps = (value: MergeCandidate) =>
  !!value.map_summary_polyline && !value.trainer;

/**
 * Plan a merge of `selected`. `library`, when given, is every activity the
 * athlete has; any other activity starting inside the merged time span makes
 * the selection non-consecutive.
 */
export function planMerge<T extends MergeCandidate>(
  selected: readonly T[],
  library?: readonly MergeCandidate[],
): MergePlan<T> {
  const parts = [...selected].sort(
    (a, b) =>
      a.start_date.getTime() - b.start_date.getTime() ||
      idOf(a).localeCompare(idOf(b)),
  );
  const blockers: MergeBlocker[] = [];
  const warnings: MergeWarning[] = [];
  const gaps: MergeGap[] = [];

  if (parts.length < MERGE_MIN_PARTS)
    blockers.push({ code: 'too_few', min: MERGE_MIN_PARTS });
  if (parts.length > MERGE_MAX_PARTS)
    blockers.push({ code: 'too_many', max: MERGE_MAX_PARTS });

  for (const part of parts) {
    if (part.manual) blockers.push({ code: 'manual', id: idOf(part) });
    if (part.elapsed_time === null || !Number.isFinite(part.elapsed_time))
      blockers.push({ code: 'missing_time', id: idOf(part) });
  }

  for (let index = 1; index < parts.length; index++) {
    const previous = parts[index - 1]!;
    const next = parts[index]!;
    const seconds = Math.round(
      (next.start_date.getTime() - endOf(previous)) / 1000,
    );
    const meters =
      validPoint(previous.end_latlng) && validPoint(next.start_latlng)
        ? Math.round(haversineMeters(previous.end_latlng, next.start_latlng))
        : null;
    gaps.push({ after: idOf(previous), seconds, meters });
    if (seconds < 0)
      blockers.push({
        code: 'overlap',
        first: idOf(previous),
        second: idOf(next),
      });
    else if (seconds > MERGE_MAX_GAP_SECONDS)
      blockers.push({ code: 'gap_too_long', after: idOf(previous), seconds });
    else if (seconds > MERGE_LONG_GAP_SECONDS)
      warnings.push({ code: 'long_gap', after: idOf(previous), seconds });
    if (meters !== null && meters > MERGE_JUMP_METERS)
      warnings.push({ code: 'jump', after: idOf(previous), meters });
  }

  if (parts.length > 0) {
    const withGps = parts.filter(hasGps).length;
    if (withGps > 0 && withGps < parts.length)
      blockers.push({ code: 'mixed_gps' });
  }

  if (library && parts.length >= 2) {
    const ids = new Set(parts.map(idOf));
    const first = parts[0]!.start_date.getTime();
    const last = endOf(parts[parts.length - 1]!);
    const between = library
      .filter((activity) => !ids.has(idOf(activity)))
      .filter((activity) => {
        const start = activity.start_date.getTime();
        return start >= first && start <= last;
      })
      .map(idOf);
    if (between.length > 0) blockers.push({ code: 'not_consecutive', between });
  }

  const sports = [...new Set(parts.map((part) => part.sport_type))];
  if (sports.length > 1) warnings.push({ code: 'mixed_sports', sports });
  if (parts.some((part) => part.private))
    warnings.push({ code: 'private_part' });
  const photos = parts.reduce(
    (sum, part) => sum + (part.total_photo_count ?? part.photo_count ?? 0),
    0,
  );
  if (photos > 0) warnings.push({ code: 'photos', count: photos });
  const kudos = parts.reduce((sum, part) => sum + (part.kudos_count ?? 0), 0);
  const comments = parts.reduce(
    (sum, part) => sum + (part.comment_count ?? 0),
    0,
  );
  if (kudos + comments > 0) warnings.push({ code: 'social', kudos, comments });

  return {
    parts,
    gaps,
    blockers,
    warnings,
    sport: mostCommonSport(parts) ?? 'Ride',
  };
}

/** The longest-running sport among the parts; ties go to the earliest. */
function mostCommonSport(parts: readonly MergeCandidate[]): SportType | null {
  const totals = new Map<SportType, number>();
  for (const part of parts)
    totals.set(
      part.sport_type,
      (totals.get(part.sport_type) ?? 0) + (part.elapsed_time ?? 0),
    );
  let best: SportType | null = null;
  for (const [sport, total] of totals)
    if (best === null || total > totals.get(best)!) best = sport;
  return best;
}

/** A default name for the merged activity. */
export function defaultMergedName(parts: readonly MergeCandidate[]): string {
  const names = [...new Set(parts.map((part) => part.name.trim()))].filter(
    Boolean,
  );
  if (names.length === 1) return names[0]!;
  return names.join(' + ').slice(0, 255);
}

/** Descriptions joined in order, keeping each part's text verbatim. */
export function defaultMergedDescription(
  parts: readonly (MergeCandidate & { description?: string | null })[],
): string {
  return parts
    .map((part) => part.description?.trim())
    .filter((value): value is string => !!value)
    .join('\n\n');
}

/** Human wording for a blocker, used by the preview. */
export function describeMergeBlocker(
  blocker: MergeBlocker,
  nameOf: (id: string) => string = (id) => id,
): string {
  switch (blocker.code) {
    case 'too_few':
      return `Select at least ${blocker.min} activities to merge.`;
    case 'too_many':
      return `At most ${blocker.max} activities can be merged at once.`;
    case 'manual':
      return `“${nameOf(blocker.id)}” was entered manually and has no recording to merge.`;
    case 'missing_time':
      return `“${nameOf(blocker.id)}” has no elapsed time.`;
    case 'overlap':
      return `“${nameOf(blocker.first)}” and “${nameOf(blocker.second)}” overlap in time.`;
    case 'gap_too_long':
      return `The break after “${nameOf(blocker.after)}” is ${formatGap(blocker.seconds)}, longer than ${formatGap(MERGE_MAX_GAP_SECONDS)}.`;
    case 'mixed_gps':
      return 'Activities with and without GPS cannot be merged.';
    case 'not_consecutive':
      return `${blocker.between.length === 1 ? 'Another activity starts' : `${blocker.between.length} other activities start`} between the selected ones. Select consecutive activities.`;
  }
}

/** Human wording for a warning, used by the preview. */
export function describeMergeWarning(
  warning: MergeWarning,
  nameOf: (id: string) => string = (id) => id,
): string {
  switch (warning.code) {
    case 'long_gap':
      return `${formatGap(warning.seconds)} break after “${nameOf(warning.after)}”, counted as stopped time.`;
    case 'jump':
      return `“${nameOf(warning.after)}” ends ${(warning.meters / 1000).toFixed(1)} km from where the next part starts. The route will jump across the gap.`;
    case 'mixed_sports':
      return `The parts have different sports (${warning.sports.join(', ')}). Pick the sport for the merged activity.`;
    case 'private_part':
      return 'At least one part is private. Strava gives uploads your default privacy setting; check the merged activity’s privacy on Strava.';
    case 'photos':
      return `${warning.count} ${warning.count === 1 ? 'photo' : 'photos'} cannot be uploaded through Strava’s API. Download them below and add them to the merged activity in the Strava app.`;
    case 'social':
      return `Kudos and comments stay with the originals (${warning.kudos} kudos, ${warning.comments} comments) and are lost when you delete them.`;
  }
}

export function formatGap(seconds: number): string {
  const minutes = Math.round(Math.abs(seconds) / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
