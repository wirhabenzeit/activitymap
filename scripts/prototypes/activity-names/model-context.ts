import type { Candidate, Feature, MatchResult } from './matching';

// OSM labels only: never invent a translation or transliteration of a place name.
export function englishName(feature: Pick<Feature, 'name' | 'tags'>) {
  return (
    [feature.tags['name:en'], feature.tags.int_name].find((name) =>
      name?.trim(),
    ) ?? feature.name
  );
}

export function buildContexts(
  results: (MatchResult & { activity: { category: string } })[],
) {
  return results.map((r, index) => {
    const relevant: Candidate[] = [
      ...r.selected,
      ...r.candidates.filter((c) => c.accepted),
    ]
      .filter((c, i, all) => all.findIndex((a) => a.id === c.id) === i)
      .sort((a, b) => a.km - b.km);
    const featureContext = (c: Feature, role: string, i: number) => ({
      key: `feature_${i + 1}`,
      name: c.name,
      displayName: englishName(c),
      englishName: c.tags['name:en'] ?? null,
      internationalName: c.tags.int_name ?? null,
      aliases: c.aliases,
      type: c.kind,
      osmClassification: {
        natural: c.tags.natural ?? null,
        mountainPass: c.tags.mountain_pass === 'yes',
        place: c.tags.place ?? null,
      },
      osmElevation: c.elevation ?? null,
      wikipedia: c.tags.wikipedia ?? null,
      wikidata: c.tags.wikidata ?? null,
      role,
    });
    const features = relevant.map((c, i) =>
      featureContext(
        c,
        r.selected.some((s) => s.id === c.id)
          ? r.confidence === 'low' && r.warnings.length
            ? 'visited_feature_but_destination_uncertain'
            : 'primary_destination'
          : 'secondary_visited_feature',
        i,
      ),
    );
    if (!features.length && r.activity.category === 'bike') {
      for (const [role, feature] of [
        ['start', r.startFeature],
        ['end', r.endFeature],
      ] as const) {
        if (feature)
          features.push(featureContext(feature, role, features.length));
      }
      if ((r.startPlace && !r.startFeature) || (r.endPlace && !r.endFeature)) {
        throw new Error(
          'Re-run the cached geometry matcher to retain endpoint OSM metadata',
        );
      }
    }
    return {
      sample: `sample_${index + 1}`,
      kind: r.activity.category,
      loop: r.loop,
      features,
    };
  });
}

export type ModelContext = ReturnType<typeof buildContexts>[number];
export type Selection = {
  selectedKeys: string[];
  format: 'destinations' | 'point_to_point' | 'loop' | 'abstain';
};

// Report model mistakes separately from the guarded suggestion; never hide them in evaluation.
export function validateSelection(context: ModelContext, selection: Selection) {
  const { selectedKeys, format } = selection;
  const chosen = selectedKeys.map((key) =>
    context.features.find((f) => f.key === key),
  );
  const errors: string[] = [];
  if (
    chosen.some((f) => !f) ||
    new Set(selectedKeys).size !== selectedKeys.length
  ) {
    return ['Unknown or duplicate feature keys'];
  }
  if (selectedKeys.length > 4) errors.push('Too many destinations');
  const positions = selectedKeys.map((key) =>
    context.features.findIndex((f) => f.key === key),
  );
  if (positions.some((p, i) => i > 0 && p <= positions[i - 1]!))
    errors.push('Wrong visit order');
  if ((format === 'abstain') !== (chosen.length === 0))
    errors.push('Invalid abstention');
  if (
    chosen.some((f) => f!.role === 'visited_feature_but_destination_uncertain')
  )
    errors.push('Uncertain feature used as destination');
  const destinationExists = context.features.some(
    (f) => f.role === 'primary_destination',
  );
  if (
    format === 'destinations' &&
    chosen.some((f) => ['start', 'end'].includes(f!.role))
  )
    errors.push('Endpoint used as destination');
  if (
    format === 'point_to_point' &&
    (context.kind !== 'bike' ||
      context.loop ||
      destinationExists ||
      chosen.length !== 2 ||
      chosen[0]?.role !== 'start' ||
      chosen[1]?.role !== 'end')
  )
    errors.push('Point-to-point requires both endpoints and no destination');
  if (
    format === 'loop' &&
    (context.kind !== 'bike' ||
      !context.loop ||
      destinationExists ||
      chosen.length !== 1 ||
      chosen[0]?.role !== 'start')
  )
    errors.push('Loop requires a start settlement and no destination');
  return errors;
}
