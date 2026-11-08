import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

/** V1 serves one combined catalogue, retaining country extracts as inputs. */
export const V1_PLACE_REGION = 'v1-places';
export const V1_PLACE_COUNTRIES = [
  'switzerland',
  'austria',
  'italy',
  'germany',
  'france',
  'norway',
  'new-zealand',
  'kyrgyzstan',
] as const;
/** Geofabrik download paths of the V1 countries. */
export const GEOFABRIK_PATHS: Record<
  (typeof V1_PLACE_COUNTRIES)[number],
  string
> = {
  switzerland: 'europe/switzerland',
  austria: 'europe/austria',
  italy: 'europe/italy',
  germany: 'europe/germany',
  france: 'europe/france',
  norway: 'europe/norway',
  'new-zealand': 'australia-oceania/new-zealand',
  kyrgyzstan: 'asia/kyrgyzstan',
};
/** Served in this order: the combined catalogue, then the earlier ch-at-it and
 * Swiss-only catalogues it replaces through consolidation. */
export const SERVING_PLACE_REGIONS = [
  V1_PLACE_REGION,
  'ch-at-it',
  'switzerland',
] as const;

const servingArray = sql`ARRAY[${sql.join(
  SERVING_PLACE_REGIONS.map((region) => sql`${region}`),
  sql`, `,
)}]::text[]`;
/** `region` is a serving region. */
export const isServingRegion = (region: SQLWrapper): SQL =>
  sql`${region} = ANY(${servingArray})`;
/** Sort key: the most preferred serving region first. */
export const servingRegionRank = (region: SQLWrapper): SQL =>
  sql`array_position(${servingArray}, ${region})`;
