import { z } from 'zod';

export const PLACE_KINDS = ['peak', 'pass', 'hut'] as const;
export const PLACE_SUBTYPES = [
  'peak',
  'natural_saddle',
  'road_trail_pass',
  'alpine_hut',
  'wilderness_hut',
] as const;
export const PLACE_RELATIONS = [
  'reached_peak',
  'reached_saddle',
  'crossed_pass', // Legacy evidence only; new matches use visited_pass.
  'visited_pass',
  'arrived_at_hut',
] as const;
export const PLACE_POINT_DERIVATIONS = [
  'osm_node',
  'validated_polygon_interior',
] as const;
export const PLACE_EVIDENCE_VERSION = 2 as const;
/** Catalogue noise rules (see place-filter.ts); hidden places are stored but
 * never read as candidates. */
export const PLACE_HIDDEN_REASONS = [
  'generic_pass_name',
  'low_relief_pass',
  'non_mountain_hut',
] as const;

export const placeKindSchema = z.enum(PLACE_KINDS);
export const placeSubtypeSchema = z.enum(PLACE_SUBTYPES);
export const placeRelationSchema = z.enum(PLACE_RELATIONS);
export const placePointDerivationSchema = z.enum(PLACE_POINT_DERIVATIONS);
export const placeHiddenReasonSchema = z.enum(PLACE_HIDDEN_REASONS);
export type PlaceHiddenReason = z.infer<typeof placeHiddenReasonSchema>;
export type PlaceKind = z.infer<typeof placeKindSchema>;
export type PlaceSubtype = z.infer<typeof placeSubtypeSchema>;
export type PlaceRelation = z.infer<typeof placeRelationSchema>;

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: 'Must contain non-whitespace text',
});
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const gpsIndex = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const code = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
const unique = <T>(values: T[]) => new Set(values).size === values.length;

export const placePointSchema = z.strictObject({
  longitude: finite.min(-180).max(180),
  latitude: finite.min(-90).max(90),
});
export type PlacePoint = z.infer<typeof placePointSchema>;

// Name-key shape is checked here; recognizing the source language and choosing
// a usable display name remain responsibilities of catalogue normalization.
const nameKey = z
  .string()
  .regex(
    /^(?:name|int_name|alt_name|old_name|loc_name|official_name|short_name)(?::[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)?$/,
  );
export const placeNamesSchema = z
  .record(nameKey, nonblank)
  .refine(
    (names) =>
      Object.keys(names).some(
        (key) =>
          key === 'name' || key === 'int_name' || key.startsWith('name:'),
      ),
    { message: 'A usable current name is required' },
  );
// z.record silently drops an own '__proto__' key. OSM tag keys are data, so
// validate the plain string record and clone with Object.fromEntries, which
// safely creates that key as an own property without changing the prototype.
export const placeTagsSchema = z
  .custom<Record<string, string>>(
    (value) => {
      if (typeof value !== 'object' || value === null) return false;
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      return Reflect.ownKeys(value).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return (
          typeof key === 'string' &&
          key.trim().length > 0 &&
          descriptor?.enumerable === true &&
          'value' in descriptor &&
          typeof descriptor.value === 'string'
        );
      });
    },
    {
      message: 'Expected a plain record of nonblank tag keys and string values',
    },
  )
  .transform((tags) => Object.fromEntries(Object.entries(tags)));
export type PlaceNames = z.infer<typeof placeNamesSchema>;
export type PlaceTags = z.infer<typeof placeTagsSchema>;

const subtypeKind: Record<PlaceSubtype, PlaceKind> = {
  peak: 'peak',
  natural_saddle: 'pass',
  road_trail_pass: 'pass',
  alpine_hut: 'hut',
  wilderness_hut: 'hut',
};
const positiveBigintString = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine(
    (value) =>
      /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9223372036854775807n,
    { message: 'Must be a positive canonical PostgreSQL bigint string' },
  );

/** Import artifact row, before assigning the persistent internal ID/import time. */
export const normalizedPlaceSchema = z
  .strictObject({
    osm_type: z.enum(['node', 'way', 'relation']),
    osm_id: positiveBigintString,
    kinds: z
      .array(placeKindSchema)
      .min(1)
      .refine(unique, 'Duplicate place kinds'),
    subtypes: z
      .array(placeSubtypeSchema)
      .min(1)
      .refine(unique, 'Duplicate place subtypes'),
    display_name: nonblank,
    names: placeNamesSchema,
    location: placePointSchema,
    elevation_m: finite.optional(),
    tags: placeTagsSchema,
    osm_version: z.number().int().positive().max(2147483647),
    osm_updated_at: z.iso.datetime({ offset: true }),
    point_derivation: placePointDerivationSchema,
    // Terrain metrics from the catalogue DEM (osm-places-v2 onwards).
    dem_elevation_m: finite.optional(),
    pass_amp_m: nonnegative.optional(),
    peak_prominence_m: nonnegative.optional(),
    peak_prominence_capped: z.boolean().optional(),
    hidden_reason: placeHiddenReasonSchema.optional(),
    normalization_version: nonblank,
    catalogue_snapshot_id: nonblank,
  })
  .superRefine((place, context) => {
    if (
      (place.peak_prominence_m === undefined) !==
      (place.peak_prominence_capped === undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['peak_prominence_capped'],
        message: 'Peak prominence and its cap flag go together',
      });
    if (
      (place.pass_amp_m !== undefined && !place.kinds.includes('pass')) ||
      (place.peak_prominence_m !== undefined && !place.kinds.includes('peak'))
    )
      context.addIssue({
        code: 'custom',
        path: ['kinds'],
        message: 'Terrain metrics must match the place kinds',
      });
    const expected = new Set(
      place.subtypes.map((subtype) => subtypeKind[subtype]),
    );
    if (
      expected.size !== place.kinds.length ||
      place.kinds.some((kind) => !expected.has(kind))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['kinds'],
        message: 'Kinds must match the selected subtypes',
      });
    }
    const validDerivation =
      place.osm_type === 'node'
        ? place.point_derivation === 'osm_node'
        : place.point_derivation === 'validated_polygon_interior' &&
          place.kinds.includes('hut');
    if (!validDerivation) {
      context.addIssue({
        code: 'custom',
        path: ['point_derivation'],
        message:
          'Point derivation is incompatible with the source representation',
      });
    }
  });
export type NormalizedPlace = z.infer<typeof normalizedPlaceSchema>;

export const placeClosestReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sample'), index: gpsIndex }),
  z
    .strictObject({
      kind: z.literal('segment'),
      start_index: gpsIndex,
      end_index: gpsIndex,
      fraction: finite.min(0).max(1),
    })
    .refine((segment) => segment.end_index === segment.start_index + 1, {
      path: ['end_index'],
      message: 'A segment must join consecutive original GPS samples',
    }),
]);

const positions = {
  start: nonnegative,
  closest: nonnegative,
  end: nonnegative,
};
const ordered = (value: { start: number; closest: number; end: number }) =>
  value.start <= value.closest && value.closest <= value.end;
export const placeElapsedSecondsSchema = z
  .strictObject(positions)
  .refine(ordered, {
    message: 'Elapsed seconds must be ordered start <= closest <= end',
  });
export const placeRouteDistanceSchema = z
  .strictObject({
    basis: z.enum(['provider_distance', 'section_gps']),
    ...positions,
  })
  .refine(ordered, {
    message: 'Route positions must be ordered start <= closest <= end',
  });

export const placeRelationAssessmentSchema = z.strictObject({
  relation: placeRelationSchema,
  status: z.enum(['supported', 'nearby', 'uncertain']),
  reason_codes: z.array(code).min(1).refine(unique, 'Duplicate reason codes'),
});

/** The peak scoring point is independent of the horizontal closest point. */
export const placePeakMatchSchema = z.strictObject({
  closest: placeClosestReferenceSchema,
  horizontal_distance_m: nonnegative,
  recorded_altitude_m: finite.optional(),
  altitude_difference_m: finite.optional(),
  weighted_score: nonnegative,
  spatial_distance_m: nonnegative.optional(),
  uses_elevation: z.boolean(),
  reliable: z.boolean(),
  route_distance_m: z
    .strictObject({
      basis: z.enum(['provider_distance', 'section_gps']),
      closest: nonnegative,
    })
    .optional(),
});

/** Structural evidence only: deciding continuity and visit support is matcher work. */
export const placeEncounterFragmentSchema = z
  .strictObject({
    section_id: gpsIndex,
    start_gps_index: gpsIndex,
    end_gps_index: gpsIndex,
    closest: placeClosestReferenceSchema,
    elapsed_s: placeElapsedSecondsSchema.optional(),
    route_distance_m: placeRouteDistanceSchema.optional(),
    min_horizontal_distance_m: nonnegative,
    peak_match: placePeakMatchSchema.optional(),
    source: z.strictObject({
      point: placePointSchema,
      mapped_elevation_m: finite.optional(),
    }),
    recorded_altitude_m: finite.optional(),
    altitude_difference_m: finite.optional(),
    relation_assessments: z
      .array(placeRelationAssessmentSchema)
      .min(1)
      .refine(
        (assessments) =>
          unique(assessments.map((assessment) => assessment.relation)),
        'Each relation may be assessed only once per episode',
      ),
    quality_flags: z.array(code).refine(unique, 'Duplicate quality flags'),
  })
  .superRefine((encounter, context) => {
    if (encounter.start_gps_index > encounter.end_gps_index) {
      context.addIssue({
        code: 'custom',
        path: ['end_gps_index'],
        message: 'Episode GPS bounds must be ordered',
      });
    }
    const reference = encounter.closest;
    const first =
      reference.kind === 'sample' ? reference.index : reference.start_index;
    const last =
      reference.kind === 'sample' ? reference.index : reference.end_index;
    if (first < encounter.start_gps_index || last > encounter.end_gps_index) {
      context.addIssue({
        code: 'custom',
        path: ['closest'],
        message: 'Closest reference must lie within the episode GPS bounds',
      });
    }
    const peak = encounter.peak_match;
    if (peak) {
      const reference = peak.closest;
      const first =
        reference.kind === 'sample' ? reference.index : reference.start_index;
      const last =
        reference.kind === 'sample' ? reference.index : reference.end_index;
      if (first < encounter.start_gps_index || last > encounter.end_gps_index)
        context.addIssue({
          code: 'custom',
          path: ['peak_match', 'closest'],
          message: 'Peak reference must lie within the episode GPS bounds',
        });
      const mapped = encounter.source.mapped_elevation_m;
      const difference =
        peak.recorded_altitude_m === undefined || mapped === undefined
          ? undefined
          : peak.recorded_altitude_m - mapped;
      if (
        peak.uses_elevation !== (difference !== undefined) ||
        peak.altitude_difference_m !== difference ||
        (difference === undefined
          ? peak.spatial_distance_m !== undefined
          : peak.spatial_distance_m !==
            Math.hypot(peak.horizontal_distance_m, difference))
      )
        context.addIssue({
          code: 'custom',
          path: ['peak_match'],
          message:
            'Peak score elevation evidence must agree with the source and scoring mode',
        });
    }
    if (encounter.altitude_difference_m !== undefined) {
      const recorded = encounter.recorded_altitude_m;
      const mapped = encounter.source.mapped_elevation_m;
      if (recorded === undefined || mapped === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['altitude_difference_m'],
          message:
            'Altitude difference requires both recorded and mapped altitude',
        });
      } else {
        const expected = recorded - mapped;
        // Permit only floating-point arithmetic error, not a matching tolerance.
        const roundingError =
          4 *
          Number.EPSILON *
          Math.max(1, Math.abs(recorded), Math.abs(mapped), Math.abs(expected));
        if (
          !Number.isFinite(expected) ||
          Math.abs(encounter.altitude_difference_m - expected) > roundingError
        ) {
          context.addIssue({
            code: 'custom',
            path: ['altitude_difference_m'],
            message:
              'Altitude difference must equal recorded minus mapped altitude',
          });
        }
      }
    }
  });
export type PlaceEncounterFragment = z.infer<
  typeof placeEncounterFragmentSchema
>;

export const placeEncounterFragmentsSchema = z
  .array(placeEncounterFragmentSchema)
  .min(1)
  .superRefine((encounters, context) => {
    for (let index = 1; index < encounters.length; index++) {
      const previous = encounters[index - 1]!;
      const current = encounters[index]!;
      const closestPosition = (episode: PlaceEncounterFragment) =>
        episode.closest.kind === 'sample'
          ? episode.closest.index
          : episode.closest.start_index + episode.closest.fraction;
      // Adjacent episodes may share the sample bracketing an exit/re-entry.
      // Their closest observations must still be distinct and chronological.
      if (
        current.start_gps_index < previous.end_gps_index ||
        current.section_id < previous.section_id ||
        closestPosition(current) <= closestPosition(previous)
      ) {
        context.addIssue({
          code: 'custom',
          path: [index, 'start_gps_index'],
          message:
            'Episodes must be in original recording order with distinct closest observations and no overlapping interiors',
        });
      }
      if (
        previous.elapsed_s &&
        current.elapsed_s &&
        current.elapsed_s.start < previous.elapsed_s.end
      ) {
        context.addIssue({
          code: 'custom',
          path: [index, 'elapsed_s'],
          message: 'Elapsed time cannot move backwards between episodes',
        });
      }
      const before = previous.route_distance_m;
      const after = current.route_distance_m;
      if (
        before &&
        after?.basis === before.basis &&
        (after.basis === 'provider_distance' ||
          previous.section_id === current.section_id) &&
        after.start < before.end
      ) {
        context.addIssue({
          code: 'custom',
          path: [index, 'route_distance_m'],
          message:
            'Route distance cannot move backwards within the same distance basis and section',
        });
      }
    }
  });

/** An unobserved recording interval; it never supplies a line or stay duration. */
export const placeEncounterPauseSchema = z
  .strictObject({
    before_gps_index: gpsIndex,
    after_gps_index: gpsIndex,
    elapsed_s: z
      .strictObject({ start: nonnegative, end: nonnegative })
      .refine((elapsed) => elapsed.end > elapsed.start, {
        message: 'A recording pause must have positive elapsed time',
      }),
    before_distance_m: nonnegative,
    after_distance_m: nonnegative,
    radius_m: finite.positive(),
  })
  .superRefine((pause, context) => {
    if (pause.after_gps_index !== pause.before_gps_index + 1)
      context.addIssue({
        code: 'custom',
        path: ['after_gps_index'],
        message: 'A recording pause must join consecutive original GPS samples',
      });
    if (
      pause.before_distance_m > pause.radius_m ||
      pause.after_distance_m > pause.radius_m
    )
      context.addIssue({
        code: 'custom',
        path: ['radius_m'],
        message:
          'Both recording-pause endpoints must be within the grouping radius',
      });
  });
export type PlaceEncounterPause = z.infer<typeof placeEncounterPauseSchema>;

/** Select one existing assessment per relation; grouping cannot create evidence. */
export function deriveEncounterAssessments(
  fragments: readonly PlaceEncounterFragment[],
): PlaceEncounterFragment['relation_assessments'] {
  const rank = { nearby: 0, uncertain: 1, supported: 2 } as const;
  const strongest = new Map<
    PlaceRelation,
    PlaceEncounterFragment['relation_assessments'][number]
  >();
  for (const fragment of fragments) {
    for (const assessment of fragment.relation_assessments) {
      const previous = strongest.get(assessment.relation);
      if (!previous || rank[assessment.status] > rank[previous.status])
        strongest.set(assessment.relation, assessment);
    }
  }
  return PLACE_RELATIONS.flatMap((relation) => {
    const assessment = strongest.get(relation);
    return assessment ? [assessment] : [];
  });
}

export function deriveEncounterQualityFlags(
  fragments: readonly PlaceEncounterFragment[],
  pauses: readonly PlaceEncounterPause[],
): string[] {
  return [
    ...new Set([
      ...fragments.flatMap((fragment) => fragment.quality_flags),
      ...(pauses.length ? ['recording_pause_grouped'] : []),
    ]),
  ].sort();
}

/** One logical encounter, retaining every continuous fragment and unobserved pause. */
export const placeEncounterSchema = z
  .strictObject({
    fragments: placeEncounterFragmentsSchema,
    pauses: z.array(placeEncounterPauseSchema),
    relation_assessments: z.array(placeRelationAssessmentSchema).min(1),
    quality_flags: z.array(code).refine(unique, 'Duplicate quality flags'),
  })
  .superRefine((encounter, context) => {
    const fragments = encounter.fragments;
    if (fragments.length === 0) return;
    if (encounter.pauses.length !== fragments.length - 1)
      context.addIssue({
        code: 'custom',
        path: ['pauses'],
        message:
          'Every adjacent fragment must have exactly one recording pause',
      });
    for (let index = 0; index < encounter.pauses.length; index++) {
      const pause = encounter.pauses[index]!;
      const before = fragments[index];
      const after = fragments[index + 1];
      if (
        !before ||
        !after ||
        before.end_gps_index !== pause.before_gps_index ||
        after.start_gps_index !== pause.after_gps_index ||
        after.section_id !== before.section_id + 1 ||
        before.elapsed_s?.end !== pause.elapsed_s.start ||
        after.elapsed_s?.start !== pause.elapsed_s.end
      )
        context.addIssue({
          code: 'custom',
          path: ['pauses', index],
          message:
            'Pause references must match adjacent sections and fragment endpoints exactly',
        });
    }
    const source = fragments[0]!.source;
    for (let index = 1; index < fragments.length; index++) {
      const other = fragments[index]!.source;
      if (
        source.point.longitude !== other.point.longitude ||
        source.point.latitude !== other.point.latitude ||
        source.mapped_elevation_m !== other.mapped_elevation_m
      )
        context.addIssue({
          code: 'custom',
          path: ['fragments', index, 'source'],
          message:
            'Grouped fragments must refer to the same catalogue point and elevation',
        });
    }
    const expectedAssessments = deriveEncounterAssessments(fragments);
    if (
      JSON.stringify(encounter.relation_assessments) !==
      JSON.stringify(expectedAssessments)
    )
      context.addIssue({
        code: 'custom',
        path: ['relation_assessments'],
        message:
          'Encounter assessments must select the first strongest existing fragment assessment',
      });
    if (
      JSON.stringify(encounter.quality_flags) !==
      JSON.stringify(deriveEncounterQualityFlags(fragments, encounter.pauses))
    )
      context.addIssue({
        code: 'custom',
        path: ['quality_flags'],
        message:
          'Encounter quality flags must exactly summarize fragments and recording pauses',
      });
  });
export type PlaceEncounter = z.infer<typeof placeEncounterSchema>;

export const placeEncountersSchema = z
  .array(placeEncounterSchema)
  .min(1)
  .superRefine((encounters, context) => {
    const ordered = placeEncounterFragmentsSchema.safeParse(
      encounters.flatMap((encounter) => encounter.fragments),
    );
    if (!ordered.success)
      context.addIssue({
        code: 'custom',
        message:
          'Encounter fragments must remain in original recording order without overlap',
      });
  });

/** Stable order, regardless of assessment order or repeated supported episodes. */
export function deriveSupportedRelations(
  encounters: readonly Pick<PlaceEncounter, 'relation_assessments'>[],
): PlaceRelation[] {
  const supported = new Set(
    encounters.flatMap((encounter) =>
      encounter.relation_assessments
        .filter((assessment) => assessment.status === 'supported')
        .map((assessment) => assessment.relation),
    ),
  );
  return PLACE_RELATIONS.filter((relation) => supported.has(relation));
}

export const activityPlaceEvidenceSchema = z
  .strictObject({
    evidence_version: z.literal(PLACE_EVIDENCE_VERSION),
    encounters: placeEncountersSchema,
    supported_relations: z
      .array(placeRelationSchema)
      .refine(unique, 'Duplicate supported relations'),
  })
  .superRefine((evidence, context) => {
    const derived = deriveSupportedRelations(evidence.encounters);
    if (
      derived.length !== evidence.supported_relations.length ||
      derived.some(
        (relation) => !evidence.supported_relations.includes(relation),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['supported_relations'],
        message:
          'Supported relations must exactly summarize the supported episode assessments',
      });
    }
  });
export type ActivityPlaceEvidence = z.infer<typeof activityPlaceEvidenceSchema>;

export function parseActivityPlaceEvidence(
  input: unknown,
): ActivityPlaceEvidence {
  return activityPlaceEvidenceSchema.parse(input);
}

export function buildActivityPlaceEvidence(
  fragments: unknown,
  pauses: unknown = [],
): ActivityPlaceEvidence {
  const parsed = placeEncounterFragmentsSchema.parse(fragments);
  const parsedPauses = z.array(placeEncounterPauseSchema).parse(pauses);
  const remaining = new Map<string, PlaceEncounterPause>();
  const key = (before: number, after: number) => `${before}:${after}`;
  for (const pause of parsedPauses) {
    const pauseKey = key(pause.before_gps_index, pause.after_gps_index);
    if (remaining.has(pauseKey))
      throw new Error('Duplicate recording pause link');
    remaining.set(pauseKey, pause);
  }
  const groups: {
    fragments: PlaceEncounterFragment[];
    pauses: PlaceEncounterPause[];
  }[] = [];
  for (const fragment of parsed) {
    const previousGroup = groups.at(-1);
    const previous = previousGroup?.fragments.at(-1);
    const pauseKey = previous
      ? key(previous.end_gps_index, fragment.start_gps_index)
      : undefined;
    const pause = pauseKey === undefined ? undefined : remaining.get(pauseKey);
    if (pause && previousGroup) {
      previousGroup.fragments.push(fragment);
      previousGroup.pauses.push(pause);
      // This is an in-memory Map, not a database delete.
      // eslint-disable-next-line drizzle/enforce-delete-with-where
      remaining.delete(pauseKey!);
    } else groups.push({ fragments: [fragment], pauses: [] });
  }
  if (remaining.size)
    throw new Error('Recording pause does not join adjacent fragments');
  const encounters = groups.map((group) => ({
    ...group,
    relation_assessments: deriveEncounterAssessments(group.fragments),
    quality_flags: deriveEncounterQualityFlags(group.fragments, group.pauses),
  }));
  return parseActivityPlaceEvidence({
    evidence_version: PLACE_EVIDENCE_VERSION,
    encounters,
    supported_relations: deriveSupportedRelations(encounters),
  });
}
