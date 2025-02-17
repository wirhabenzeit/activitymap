import type { Activity } from '~/server/db/schema';

export const sportTypes = [
  'AlpineSki',
  'BackcountrySki',
  'Badminton',
  'Canoeing',
  'Crossfit',
  'EBikeRide',
  'EMountainBikeRide',
  'Elliptical',
  'Golf',
  'GravelRide',
  'Handcycle',
  'HighIntensityIntervalTraining',
  'Hike',
  'IceSkate',
  'InlineSkate',
  'Kayaking',
  'Kitesurf',
  'MountainBikeRide',
  'NordicSki',
  'Pickleball',
  'Pilates',
  'Racquetball',
  'Ride',
  'RockClimbing',
  'RollerSki',
  'Rowing',
  'Run',
  'Sail',
  'Skateboard',
  'Snowboard',
  'Snowshoe',
  'Soccer',
  'Squash',
  'StairStepper',
  'StandUpPaddling',
  'Surfing',
  'Swim',
  'TableTennis',
  'Tennis',
  'TrailRun',
  'Velomobile',
  'VirtualRide',
  'VirtualRow',
  'VirtualRun',
  'Walk',
  'WeightTraining',
  'Wheelchair',
  'Windsurf',
  'Workout',
  'Yoga',
] as const;

export type SportType = (typeof sportTypes)[number];

export interface StravaAthlete {
  id: number;
  resource_state: number;
  firstname: string;
  lastname: string;
  profile_medium: string;
  profile: string;
  city: string;
  state: string;
  country: string;
  sex: string;
  premium: boolean;
  summit: boolean;
  created_at: string;
  updated_at: string;
}

export interface StravaMap {
  id: string;
  polyline: string | null;
  summary_polyline: string | null;
  resource_state: number;
  bbox?: [number, number, number, number];
}

export interface StravaActivity {
  id: number;
  resource_state: number;
  athlete: StravaAthlete;
  name: string;
  description: string | null;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  elev_high: number | null;
  elev_low: number | null;
  sport_type: SportType;
  start_date: string;
  start_date_local: string;
  timezone: string;
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;
  achievement_count: number;
  kudos_count: number;
  comment_count: number;
  athlete_count: number;
  photo_count: number;
  total_photo_count: number;
  map: StravaMap;
  trainer: boolean;
  commute: boolean;
  manual: boolean;
  private: boolean;
  flagged: boolean;
  workout_type: number | null;
  upload_id: number | null;
  average_speed: number;
  max_speed: number;
  has_kudoed: boolean;
  hide_from_home: boolean;
  gear_id: string | null;
  kilojoules: number | null;
  average_watts: number | null;
  device_watts: boolean | null;
  max_watts: number | null;
  weighted_average_watts: number | null;
  calories: number | null;
  device_name: string | null;
  pr_count: number;
}

export interface StravaPhoto {
  unique_id: string;
  activity_id: number;
  activity_name: string | null;
  resource_state: number;
  caption: string | null;
  type: number;
  source: number;
  post_id: number | null;
  uploaded_at: string | null;
  created_at: string | null;
  urls: Record<string, string>;
  sizes: Record<string, [number, number]>;
  default_photo: boolean;
  location: [number, number] | null;
}

// Add a mutable version of StravaPhoto for internal use
export interface MutableStravaPhoto extends StravaPhoto {
  location: [number, number] | null;
}

export interface StravaSubscription {
  id: number;
  resource_state: number;
  application_id: number;
  callback_url: string;
  created_at: string;
  updated_at: string;
}

export class StravaError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Array<{ resource: string; field: string; code: string }>,
  ) {
    super(message);
    this.name = 'StravaError';
  }
}

export type UpdatableActivity = {
  id: number;
  athlete: number;
  name?: string;
  description?: string;
  sport_type?: Activity['sport_type'];
  commute?: boolean;
  hide_from_home?: boolean;
  gear_id?: string;
};
