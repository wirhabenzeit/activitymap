import {
  type FilteredContext,
  type Question,
  filterContext,
} from './filtered-context';
import {
  closest,
  compactRows,
  slimContext,
  sportInput,
} from './jev-tuning-context';

type Feature = FilteredContext['features'][number];

// Keep the frozen shortlist, adding a few destination types it discarded.
// Selection is deliberately permissive; Jev still decides visits and significance.
export function destinationContext(context: FilteredContext) {
  const original = slimContext(
    filterContext(context, context.highPoints).context,
  );
  const kept = new Map(
    original.context.features.map((f) => [f.key, 'previous shortlist']),
  );
  const distance = (f: Feature) => closest(context, f)?.distanceM ?? Infinity;
  const add = (items: Feature[], count: number, reason: string) => {
    for (const f of items.slice(0, count))
      if (!kept.has(f.key)) kept.set(f.key, reason);
  };
  if (context.route.sport === 'bike') {
    add(
      context.features
        .filter((f) => {
          const e = closest(context, f);
          return (
            f.type === 'peak' &&
            distance(f) <= 180 &&
            e &&
            context.highPoints.some(
              (p) =>
                (Math.abs(p.routePercent - (e.routePercent ?? -1000)) *
                  (context.route.distanceKm ?? 0)) /
                  100 <=
                0.75,
            )
          );
        })
        .sort((a, b) => distance(a) - distance(b)),
      2,
      'cycling summit near route high point',
    );
  } else if (context.route.sport === 'hike') {
    // A non-summit hike can be described by a visited hamlet/area. Keep a small
    // reserve independently of the high-point test, which misses shore walks.
    add(
      context.features
        .filter(
          (f) =>
            f.type === 'place' &&
            !f.aerialway &&
            ['hamlet', 'village', 'town'].includes(f.place ?? '') &&
            distance(f) <= 150 &&
            (f.startDistanceM ?? 0) > 1500 &&
            (f.endDistanceM ?? 0) > 1500,
        )
        .sort((a, b) => distance(a) - distance(b)),
      2,
      'interior settlement / area context',
    );
  }
  const features = context.features.filter((f) => kept.has(f.key));
  return {
    context: {
      ...context,
      features,
      encounters: context.encounters.filter((e) => kept.has(e.feature)),
    },
    audit: {
      originalCount: context.features.length,
      previousCount: original.context.features.length,
      selectedCount: features.length,
      retained: [...kept].map(([key, reason]) => ({ key, reason })),
      removed: context.features
        .filter((f) => !kept.has(f.key))
        .map((f) => ({ key: f.key, name: f.name, type: f.type })),
    },
  };
}

export function visitationInput(context: FilteredContext, reversed = false) {
  const input = sportInput(context);
  input.state +=
    '\nA mountain already reached at the start can name a descent outing; an ascent within this recording is not required. For a non-summit hike, a meaningful visited area or hut can be the main destination. Ordinary approach villages remain incidental. A route stopping below a summit can have no supported summit; never substitute another nearby peak merely to produce a title.';
  for (const row of compactRows(context)) {
    const f = context.features.find((f) => f.key === row.key)!;
    const visits = context.encounters
      .filter((e) => e.feature === f.key)
      .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity))
      .slice(0, 4);
    const evidence = visits
      .map((e) => {
        const gap =
          f.osmElevationM !== null && e.routeElevationM !== null
            ? f.osmElevationM - e.routeElevationM
            : null;
        const horizontal =
          e.distanceM === null
            ? 'horizontal distance unknown'
            : e.distanceM <= 50
              ? 'track directly by feature'
              : e.distanceM <= 150
                ? 'track close to feature'
                : 'feature offset from track';
        const vertical =
          gap === null
            ? 'elevation agreement unknown'
            : Math.abs(gap) <= 30
              ? 'elevations closely agree'
              : Math.abs(gap) <= 90
                ? 'moderate elevation difference'
                : gap > 0
                  ? 'feature substantially ABOVE track'
                  : 'feature substantially BELOW track';
        return `at ${e.routePercent ?? '?'}%: ${e.distanceM ?? '?'} m horizontal (${horizontal}); map minus track ${gap ?? '?'} m (${vertical})`;
      })
      .join('; ');
    const q: Question = {
      type: 'choice',
      instructions: `Was ${JSON.stringify(f.name)} (${f.type}, ${f.key}) actually reached/crossed? Its own encounter evidence: ${evidence || 'none'}. Use one consistent encounter, not another candidate's elevation. A higher point elsewhere on the route does not prove this feature was visited. Starting at a summit counts as reaching it. Judge actual visitation independently of whether this would make a nice title.`,
      criteria: {
        supported:
          'Convincing reach/crossing: track directly by a peak/pass with closely agreeing elevations, or close with only moderate recording differences and a convincing approach. No substantial contradictory offset. A visited settlement/area can have an offset centre; summit-style precision is not required for an area.',
        uncertain:
          'A possible visit with material uncertainty: moderate horizontal/height offsets, missing evidence, or recording error prevents a confident reach/crossing judgment. Use this for a possible intended summit that cannot be confirmed.',
        nearby:
          'The route only passes nearby or above/below this feature. A summit with substantial horizontal and/or height disagreement is unsupported. Being lower than the route or sharing its high-point vicinity does not establish a visit.',
      },
    };
    input.questions[`${f.key}_visit`] = q;
    if (context.route.sport !== 'bike') {
      const role = input.questions[`${f.key}_role`]!;
      role.criteria.main +=
        ' A main mountain at the recording start can name a descent. A meaningful visited area or hut can name a non-summit hike.';
      role.instructions +=
        ' A summit at the start is not incidental merely because the recording then descends. Keep independently significant mountains, including a separate later climb; omit lesser ridge bumps.';
    }
  }
  if (reversed)
    for (const q of Object.values(input.questions))
      q.criteria = Object.fromEntries(Object.entries(q.criteria).reverse());
  return input;
}

// Keep the original shared state and significance criteria. Only explain the
// point-feature evidence inline, without making Jev subtract heights or resolve
// a generic settlement exception for a summit.
export function focusedVisitationInput(
  context: FilteredContext,
  reversed = false,
) {
  const input = sportInput(context);
  for (const f of context.features) {
    const pointFeature = f.type === 'peak' || f.type === 'pass';
    const evidence = context.encounters
      .filter((e) => e.feature === f.key)
      .map((e) => {
        const gap =
          f.osmElevationM !== null && e.routeElevationM !== null
            ? f.osmElevationM - e.routeElevationM
            : null;
        return `At ${e.routePercent ?? '?'}%: track gap ${e.distanceM ?? '?'} m; map minus track ${gap ?? '?'} m. Substantial height mismatch: ${gap === null ? 'unknown' : Math.abs(gap) > 90 ? 'YES' : 'NO'}. Substantial horizontal separation: ${e.distanceM === null ? 'unknown' : e.distanceM > 250 ? 'YES' : 'NO'}.`;
      })
      .join(' ');
    input.questions[`${f.key}_visit`] = {
      type: 'choice',
      instructions: `Does this recorded route actually reach ${JSON.stringify(f.name)} (${f.type})? ${evidence || 'No encounter evidence.'} Use this feature's own encounter. Starting on a summit counts; ascent within the recording is not required. A route can stop below all summits. ${pointFeature ? 'This is a point feature: use horizontal AND height agreement. Do not apply settlement/area-centre tolerance to it.' : 'This is an area or hut: judge whether the track visits the named place, allowing an offset area centre.'}`,
      criteria: pointFeature
        ? {
            supported:
              'A convincing reach/crossing. An encounter has NO substantial height mismatch and NO substantial horizontal separation, with close position and plausible height agreement. Small recording discrepancies are acceptable.',
            uncertain:
              'The route may approach this point, but missing height evidence or material position/height offsets leave a visit ambiguous. A possible intended summit is not a confirmed summit.',
            nearby:
              'The point was only nearby. Evidence explicitly says YES for substantial height mismatch or substantial horizontal separation; the route passes above/below or stops short. Do not claim a visit just because this point is near the route high point.',
          }
        : {
            supported:
              'The route convincingly visits this named area or hut. An area centre can be offset from the path; elevation may be unknown.',
            uncertain:
              'A possible visit, but the track evidence does not clearly distinguish reaching this place from passing nearby.',
            nearby:
              'This named place is only nearby or unrelated to the recorded route.',
          },
    };
    // This is a route-shape condition, applied consistently to every recording.
    const startsHigh =
      context.route.startElevationM !== null &&
      context.route.maxElevationM !== null &&
      context.route.endElevationM !== null &&
      context.route.startElevationM >= context.route.maxElevationM - 300 &&
      context.route.startElevationM - context.route.endElevationM >= 300;
    if (f.type === 'peak' && context.route.sport !== 'bike' && startsHigh) {
      input.questions[`${f.key}_role`]!.instructions +=
        ' This recording starts high and ends substantially lower. A main mountain at the start can name this descent even without a recorded ascent. Do not mark it secondary merely because it appears at the beginning.';
    }
  }
  if (reversed)
    for (const q of Object.values(input.questions))
      q.criteria = Object.fromEntries(Object.entries(q.criteria).reverse());
  return input;
}
