/** Recommended draft policy: destination-preserving filter and existing wording. */
import { destinationContext } from '../destination-context';
import { deduplicate, highPoints } from '../filtered-context';
import { sportInput } from '../jev-tuning-context';
import { type Feature, type Streams, routePoints, suggest } from '../matching';
import { richContext } from '../rich-context';
import { placeKind } from './osm';

export const TITLE_POLICY_VERSION = 'osm-jev-title-v1-draft';
export type NamingSport = 'bike' | 'hike' | 'ski';
export type NameLanguage = 'en' | 'local';

export function prepareJevInput(
  streams: Streams,
  sport: NamingSport,
  places: Feature[],
  language: NameLanguage = 'en',
) {
  const { points, warnings } = routePoints(streams);
  const allowed = places.flatMap((f) => {
    const kind = placeKind(f.tags);
    return kind ? [{ ...f, kind }] : [];
  });
  // The legacy matcher's accepted/title fields are intentionally unused. Every
  // scoped corridor candidate remains evidence, including uncertain approaches.
  const candidates = suggest(points, allowed, sport).candidates;
  const evidence = richContext(sport, candidates, points);
  if (language === 'local')
    for (const f of evidence.features) {
      f.name = f.localName ?? f.name;
      f.localName = null;
    }
  const unique = deduplicate(evidence, candidates);
  const { context, audit } = destinationContext({
    ...unique.context,
    highPoints: highPoints(points),
  });
  const input = sportInput(context);
  if (language === 'local')
    input.state = input.state.replace(
      'English/international names are already provided; do not invent translations.',
      'Local map names are already provided; do not invent translations.',
    );
  return {
    version: TITLE_POLICY_VERSION,
    context,
    input,
    audit,
    warnings,
    // A persistence adapter can add activity ownership/generation here. Neither
    // these OSM identities nor coordinates are included in input sent to Jev.
    places: candidates.map(
      ({ id, name, aliases, kind, lat, lon, elevation, tags }) => ({
        id,
        name,
        aliases,
        kind,
        lat,
        lon,
        elevation,
        tags,
      }),
    ),
    encounters: evidence.encounters.map(({ feature, ...encounter }) => ({
      ...encounter,
      placeId: candidates[Number(feature.slice(1)) - 1]!.id,
    })),
  };
}

export type JevInput = ReturnType<typeof prepareJevInput>['input'];
export type PreparedInference = ReturnType<typeof prepareJevInput>;
