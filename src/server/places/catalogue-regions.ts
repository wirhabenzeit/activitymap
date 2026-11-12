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
