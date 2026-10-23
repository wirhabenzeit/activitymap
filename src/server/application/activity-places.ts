import type { GeometryCollection } from 'geojson';

import type { Actor } from '../auth/actor';
import {
  type ValidatedCatalogue,
  validateCatalogue,
} from '../places/catalogue-artifact';
import type { CoverageGeometry } from '../places/coverage';
import { matchEncounters } from '../places/encounters';
import {
  MATCHER_VERSION,
  type MatcherPolicy,
  parametersHash,
  validatePolicy,
} from '../places/policy';
import {
  parseEvaluationContext,
  runIdentitySchema,
} from '../places/run-manifest';
import type {
  ActivityMatchInput,
  ActivityRunRecord,
  CandidatePlace,
  PlaceMatch,
  RunIdentity,
} from '../places/run-types';
import { type PreparedTrack, prepareTrack } from '../places/track-sections';

/** Explicit dependencies prevent this manual experiment using the app's default DB. */
export type MatchingRepositories = {
  places: {
    assertCatalogue(snapshotId: string, count: number): Promise<void>;
    discover(input: {
      geometry: GeometryCollection;
      coverage: CoverageGeometry;
      radiusM: number;
      limit: number;
      catalogueSnapshotId: string;
    }): Promise<{
      candidates: CandidatePlace[];
      covered: boolean;
      truncated: boolean;
    }>;
  };
  activityPlaces: {
    withAthleteRunLock<T>(actor: Actor, work: () => Promise<T>): Promise<T>;
    readInput(
      actor: Actor,
      activityId: string,
    ): Promise<ActivityMatchInput | null>;
    publish(
      actor: Actor,
      input: ActivityMatchInput,
      identity: RunIdentity,
      matches: PlaceMatch[],
    ): Promise<'published' | 'superseded'>;
  };
};
export type ActivityMatchReport = {
  activityId: string;
  input?: ActivityMatchInput['tokens'];
  geometry: GeometryCollection;
  sections: PreparedTrack['sections'];
  qualityFlags: string[];
  candidates: CandidatePlace[];
  matches: PlaceMatch[];
  reasons: string[];
};

export async function runActivityPlaceMatching(options: {
  actor: Actor;
  activityIds: string[];
  catalogue: ValidatedCatalogue;
  policy: MatcherPolicy;
  identity: RunIdentity;
  repositories: MatchingRepositories;
  apply?: boolean;
  /** Persist diagnostics before publication. I/O failures abort, not hide a run. */
  onReport(report: ActivityMatchReport): Promise<void>;
  /** Persist each outcome after commit. If interrupted here, rerun that activity. */
  onRecord(record: ActivityRunRecord): Promise<void>;
}): Promise<ActivityRunRecord[]> {
  const apply = options.apply === true;
  const identity = runIdentitySchema.parse(options.identity);
  const context = parseEvaluationContext({
    ...identity,
    actor: options.actor,
    activityIds: options.activityIds,
    records: [],
  });
  const catalogue = validateCatalogue(options.catalogue);
  const policy = validatePolicy(options.policy);
  if (
    context.catalogueSnapshotId !== catalogue.manifest.catalogue_snapshot_id ||
    context.matcherVersion !== MATCHER_VERSION ||
    context.parametersHash !== parametersHash(policy)
  )
    throw new Error(
      'Run identity must match the validated catalogue and policy',
    );
  const { places, activityPlaces } = options.repositories;
  return activityPlaces.withAthleteRunLock(context.actor, async () => {
    await places.assertCatalogue(
      context.catalogueSnapshotId,
      catalogue.rows.length,
    );
    const records: ActivityRunRecord[] = [];
    for (const activityId of context.activityIds) {
      let input: ActivityMatchInput | null = null;
      const report: ActivityMatchReport = {
        activityId,
        geometry: { type: 'GeometryCollection', geometries: [] },
        sections: [],
        qualityFlags: [],
        candidates: [],
        matches: [],
        reasons: [],
      };
      const record: ActivityRunRecord = {
        activityId,
        outcome: 'failed',
        published: false,
        matchCount: 0,
        reasons: [],
      };
      try {
        input = await activityPlaces.readInput(context.actor, activityId);
        if (!input) {
          record.outcome = 'missing_streams';
          record.reasons = ['no_current_stored_streams'];
        } else {
          record.input = input.tokens;
          report.input = input.tokens;
          const track = prepareTrack(input.payload, policy);
          report.geometry = track.geometry;
          report.sections = track.sections;
          report.qualityFlags = track.qualityFlags;
          if (track.sections.length === 0) {
            record.outcome = track.partial ? 'partial' : 'missing_streams';
            record.reasons = [...new Set([...track.reasons, 'no_usable_gps'])];
          } else {
            const discovery = await places.discover({
              geometry: track.geometry,
              coverage: catalogue.coverage,
              radiusM: policy.discoveryRadiusM,
              limit: policy.maxCandidates,
              catalogueSnapshotId: context.catalogueSnapshotId,
            });
            report.candidates = discovery.candidates;
            const matched = matchEncounters(
              track,
              discovery.candidates,
              policy,
            );
            report.matches = matched.matches;
            record.matchCount = matched.matches.length;
            record.reasons = [
              ...new Set([
                ...track.reasons,
                ...matched.reasons,
                ...(discovery.truncated ? ['candidate_limit'] : []),
                ...(!discovery.covered
                  ? ['discovery_corridor_outside_coverage']
                  : []),
              ]),
            ];
            record.outcome = !discovery.covered
              ? 'uncovered'
              : track.partial || matched.partial || discovery.truncated
                ? 'partial'
                : 'complete';
          }
        }
      } catch {
        // DB errors can contain SQL and raw payloads; keep the private report useful
        // without copying credentials or unrelated account data into it.
        record.outcome = 'failed';
        record.reasons = ['processing_failed'];
      }
      report.reasons = record.reasons;
      await options.onReport(structuredClone(report));
      if (apply && input && record.outcome === 'complete') {
        try {
          const publication = await activityPlaces.publish(
            context.actor,
            input,
            identity,
            report.matches,
          );
          record.published = publication === 'published';
          if (!record.published) {
            record.outcome = 'superseded';
            record.reasons = ['input_or_authorization_changed'];
          }
        } catch {
          record.outcome = 'failed';
          record.reasons = ['publication_failed'];
        }
      }
      // Clone before handing results to an I/O callback to prevent later mutation.
      await options.onRecord(structuredClone(record));
      records.push(record);
    }
    return records;
  });
}
