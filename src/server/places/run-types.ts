import type { buildActivityPlaceEvidence } from './types';

export type { CandidatePlace } from '../repositories/places';
export type PlaceMatch = {
  placeId: string;
  evidence: ReturnType<typeof buildActivityPlaceEvidence>;
};
