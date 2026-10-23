import type { Actor } from '../auth/actor';
import type {
  PlaceKind,
  PlacePoint,
  PlaceSubtype,
  buildActivityPlaceEvidence,
} from './types';

/** Local experiment boundaries; IDs remain lossless at every JSON boundary. */
export type CandidatePlace = {
  id: string;
  displayName: string;
  kinds: PlaceKind[];
  subtypes: PlaceSubtype[];
  location: PlacePoint;
  elevationM?: number;
};
export type PlaceMatch = {
  placeId: string;
  evidence: ReturnType<typeof buildActivityPlaceEvidence>;
};
export type InputTokens = {
  generation: string;
  revision: string;
  sourceVersion: string;
};
export type ActivityMatchInput = {
  activityId: string;
  tokens: InputTokens;
  payload: unknown;
};
export type RunIdentity = {
  runId: string;
  catalogueSnapshotId: string;
  matcherVersion: string;
  parametersHash: string;
};
export type MatchOutcome =
  // All recorded sections evaluated; may contain unobserved recording pauses.
  | 'complete'
  | 'missing_streams'
  | 'uncovered'
  | 'partial'
  | 'failed'
  | 'superseded';
export type ActivityRunRecord = {
  activityId: string;
  outcome: MatchOutcome;
  input?: InputTokens;
  published: boolean;
  matchCount: number;
  reasons: string[];
};
export type EvaluationContext = RunIdentity & {
  actor: Actor;
  activityIds: string[];
  records: ActivityRunRecord[];
};
