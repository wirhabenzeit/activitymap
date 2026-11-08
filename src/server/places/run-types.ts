import type {
  PlaceKind,
  PlacePoint,
  PlaceSubtype,
  buildActivityPlaceEvidence,
} from './types';

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
