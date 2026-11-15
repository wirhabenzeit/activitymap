/** Human title for a Strava sport protocol value ("MountainBikeRide" -> "Mountain bike ride").
 * Mirrors iOS `SportType.editingTitle` in sentence case; the protocol value is never changed. */
export function sportTitle(sportType: string): string {
  if (sportType === 'EBikeRide') return 'E-bike ride';
  if (sportType === 'EMountainBikeRide') return 'E-mountain bike ride';
  const [first = '', ...rest] = sportType
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ');
  return [first, ...rest.map((word) => word.toLowerCase())].join(' ');
}
