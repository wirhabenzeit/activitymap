import type { SportType } from '~/contracts/sport';
import type { StoredStreamSummary } from '~/lib/streams/compact-summary';
import type {
  ActivityStreamType,
  RawActivityStreams,
  StreamFetchFailure,
} from '~/server/strava/streams';

/**
 * The shapes of the records the app keeps. They were the Postgres tables'
 * rows; the records now live in the Convex backend (`backend/convex`), and
 * these types describe what crosses the bridges and reaches the clients.
 */

/** Who writes an account's library. */
export type Writer = 'postgres' | 'handoff' | 'convex';

/** A user, as the sign-in store in Convex holds it. */
export type User = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean | null;
  image: string | null;
  athlete_id: number | null;
  oldest_activity_reached: boolean;
  lastSummaryReconciledAt: Date | null;
  writer: Writer;
  writerEpoch: number;
  convexEpoch: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/** A provider account linked to a user (Strava), with its tokens. */
export type Account = {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  userId: string;
  type: string | null;
  provider: string | null;
  providerId: string;
  providerAccountId: string | null;
  accountId: string;
  refresh_token: string | null;
  refreshToken: string | null;
  access_token: string | null;
  accessToken: string | null;
  expires_at: number | null;
  expiresAt: Date | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  password: string | null;
  token_type: string | null;
  scope: string | null;
  id_token: string | null;
  idToken: string | null;
  session_state: string | null;
  revokedAt: Date | null;
  scheduledErasureAt: Date | null;
};

/** An activity in the shape the app and its clients use. */
export type Activity = {
  id: number;
  name: string;
  public_id: number;
  athlete: number;
  description: string | null;
  distance: number | null;
  moving_time: number | null;
  elapsed_time: number | null;
  total_elevation_gain: number | null;
  sport_type: SportType;
  start_date: Date;
  start_date_local: Date;
  timezone: string;
  start_latlng: number[] | null;
  end_latlng: number[] | null;
  achievement_count: number | null;
  kudos_count: number | null;
  comment_count: number | null;
  athlete_count: number | null;
  photo_count: number | null;
  total_photo_count: number | null;
  map_id: string | null;
  map_polyline: string | null;
  map_summary_polyline: string | null;
  map_bbox: number[] | null;
  trainer: boolean | null;
  commute: boolean | null;
  manual: boolean | null;
  private: boolean | null;
  flagged: boolean | null;
  workout_type: number | null;
  upload_id: number | null;
  average_speed: number | null;
  max_speed: number | null;
  calories: number | null;
  has_heartrate: boolean | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  heartrate_opt_out: boolean | null;
  display_hide_heartrate_option: boolean | null;
  elev_high: number | null;
  elev_low: number | null;
  pr_count: number | null;
  has_kudoed: boolean | null;
  hide_from_home: boolean | null;
  gear_id: string | null;
  device_watts: boolean | null;
  average_watts: number | null;
  max_watts: number | null;
  weighted_average_watts: number | null;
  kilojoules: number | null;
  last_updated: Date | null;
  geometryState: 'summary' | 'detailed' | 'refresh_required';
  photosState: 'refresh_required' | 'current' | null;
  lastSummarySeenAt: Date | null;
  lastDetailedFetchedAt: Date | null;
  is_complete: boolean;
};

/** A photo of an activity. */
export type Photo = {
  athlete_id: number;
  type: number;
  unique_id: string;
  activity_id: number;
  activity_name: string | null;
  caption: string | null;
  source: number | null;
  urls: Record<string, string> | null;
  sizes: Record<string, [number, number]> | null;
  default_photo: boolean | null;
  location: number[] | null;
  uploaded_at: Date | null;
  created_at: Date | null;
  post_id: number | null;
  status: string | null;
  resource_state: number | null;
};

/** A one-time code of the mobile sign-in exchange. */
export type MobileLoginCode = {
  id: string;
  createdAt: Date;
  userId: string;
  expiresAt: Date;
  codeHash: string;
  state: string;
  pkceChallenge: string;
  redirectUri: string;
  sessionBearerToken: string | null;
  consumedAt: Date | null;
};

/** One entry of a library's change feed. */
export type SyncChange = {
  sequence: number;
  athleteId: number;
  entityType: 'activity' | 'photo';
  entityId: string;
  operation: 'upsert' | 'delete';
  changedAt: Date;
};

/** An activity's stored recording and its fetch state. */
export type StoredStreams = {
  summary: StoredStreamSummary | null;
  activityId: bigint;
  generation: string;
  attemptId: string | null;
  requestedTypes: ActivityStreamType[];
  payload: RawActivityStreams | null;
  availableTypes: ActivityStreamType[];
  revision: bigint;
  sourceVersion: string | null;
  fetchedAt: Date | null;
  lastAttemptAt: Date;
  lastAttemptStatus: 'pending' | 'succeeded' | 'failed' | 'invalidated';
  lastError: StreamFetchFailure | null;
  invalidatedAt: Date | null;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
};
