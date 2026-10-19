import type {
  ActivityDTO,
  GeometryState,
  PhotosState,
} from '~/contracts/v1/activity';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';

/**
 * Read-only activity data for client presentation and commands. Numeric IDs and
 * Date values preserve the current web navigation/selection contract. Transport
 * freshness timestamps, legacy sharing tokens and persistence flags stay out of
 * components; stream metadata explicitly belongs to this projection.
 */
export type Activity = Omit<
  ActivityDTO,
  | 'id'
  | 'athlete'
  | 'upload_id'
  | 'start_date'
  | 'start_date_local'
  | 'streams'
  | 'geometry_state'
  | 'photos_state'
  | 'last_updated'
  | 'last_summary_seen_at'
  | 'last_detailed_fetched_at'
> & {
  id: number;
  athlete: number;
  upload_id: number | null;
  start_date: Date;
  start_date_local: Date;
  geometryState: GeometryState;
  photosState: PhotosState | null;
  streamsMetadata?: StreamMetadata;
};
