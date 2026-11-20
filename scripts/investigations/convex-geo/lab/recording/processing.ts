import { matchEncounters } from '../../../../../src/server/places/encounters';
import { DEFAULT_MATCHER_POLICY } from '../../../../../src/server/places/policy';
import { prepareTrack } from '../../../../../src/server/places/track-sections';
import type { RawActivityStreams } from '../../../../../src/server/strava/streams';

export { recordingSummary } from '../../../../../backend/recording/summary';

// Prove the existing Node-compatible matching core can consume decoded files.
// Catalogue discovery and hosted matching are separate work.
export function fixtureMatch(streams: RawActivityStreams) {
  const track = prepareTrack(streams, DEFAULT_MATCHER_POLICY);
  return matchEncounters(
    track,
    [
      {
        id: 'synthetic-peak',
        displayName: 'Synthetic peak',
        kinds: ['peak'],
        subtypes: ['peak'],
        location: { latitude: 46, longitude: 8 },
        elevationM: 0,
      },
    ],
    DEFAULT_MATCHER_POLICY,
  );
}
