// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decode, encode } from "https://esm.sh/@googlemaps/polyline-codec";

function simplify_activity(activity) {
  console.log(activity);
  const result_keys : string[] = ['id', 'resource_state', 'name', 'distance', 'moving_time', 'elapsed_time', 'total_elevation_gain', 'type', 'sport_type', 'workout_type', 'start_date', 'start_date_local', 'timezone', 'utc_offset', 'location_city', 'location_state', 'location_country', 'achievement_count', 'kudos_count', 'comment_count', 'athlete_count', 'photo_count', 'trainer', 'commute', 'manual', 'private', 'visibility', 'flagged', 'gear_id', 'start_latlng', 'end_latlng', 'average_speed', 'max_speed', 'average_cadence', 'average_temp', 'average_watts', 'max_watts', 'weighted_average_watts', 'kilojoules', 'device_watts', 'has_heartrate', 'average_heartrate', 'max_heartrate', 'heartrate_opt_out', 'display_hide_heartrate_option', 'elev_high', 'elev_low', 'upload_id', 'upload_id_str', 'external_id', 'from_accepted_tag', 'pr_count', 'total_photo_count', 'has_kudoed', 'suffer_score']
  const simplified_activity: { [key: string]: any } = {};
  for (const key of result_keys) {
    simplified_activity[key] = activity[key]
  }
  simplified_activity['start_date_local_timestamp'] = Math.round(new Date(activity['start_date_local']).getTime()/1000)
  simplified_activity['athlete'] = activity['athlete']['id']
  if ('map' in activity) {
    var coordinates = ("polyline" in activity['map']) ? decode(activity['map']['polyline'],5) : decode(activity['map']['summary_polyline'],5)
    coordinates = coordinates.map((coordinate: number[]) => [coordinate[1], coordinate[0]])
    simplified_activity['geometry'] = {type: "LineString", coordinates: coordinates}
    var coordinates = decode(activity['map']['summary_polyline'],5)
    coordinates = coordinates.map((coordinate: number[]) => [coordinate[1], coordinate[0]])
    simplified_activity['geometry_simplified'] = {type: "LineString", coordinates: coordinates}
  }
  return simplified_activity
}

serve(async (req: Request) => {
  let args;
  if (req.method == "GET") {
    const url = new URL(req.url);
    args = Object.fromEntries(url.searchParams.entries());
  } else {
    args = await req.json();
  }
  console.log("Received:", args);
  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {auth: {
    autoRefreshToken: false,
    persistSession: false
  }});
  if ('aspect_type' in args && args["object_type"]=="activity" && "object_id" in args && (args["aspect_type"] == "update" || args["aspect_type"] == "create")) {
    const athlete = parseInt(args["owner_id"]);
    const id = parseInt(args["object_id"]);
    console.log(athlete, id);
    const { data, error } = await supabaseClient.from("strava-athletes").select("*").eq("id", athlete).single();
    const response = await fetch(`https://www.strava.com/api/v3/activities/${id}?include_all_efforts=false`, {headers: {'Authorization': "Bearer " + data['access_token']}});
    const activity = await response.json();
    const simplified_activity = simplify_activity(activity);
    const { data2, erro2 } = await supabaseClient.from("strava-activities").upsert(simplified_activity, {onConflict: 'id',ignoreDuplicates: false});
    console.log(data2,erro2);
    return new Response(
      JSON.stringify(simplified_activity),
      { headers: { "Content-Type": "application/json" } },
      )
    }
    else if ('aspect_type' in args && args['aspect_type']=="create" && "page" in args) {
      const athlete = parseInt(args["owner_id"]);
      const page = parseInt(args["page"]);
      console.log(athlete, page);
      const { data, error } = await supabaseClient.from("strava-athletes").select("*").eq("id", athlete).single();
      const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=200`, {headers: {'Authorization': "Bearer " + data['access_token']}});
      const activities = await response.json();
      console.log(activities.length);
      const simplified_activities = activities.map(simplify_activity);
      const { data2, erro2 } = await supabaseClient.from("strava-activities").upsert(simplified_activities, {onConflict: 'id',ignoreDuplicates: false});
      console.log(data2,erro2);
      return new Response(
        JSON.stringify(simplified_activities),
        { headers: { "Content-Type": "application/json" } },
        )
    }
    else if ('hub.challenge' in args) {
      return new Response(
        JSON.stringify({"hub.challenge": args['hub.challenge']}),
        { headers: { "Content-Type": "application/json" } },
        )
      }
      else {
        return new Response(
          JSON.stringify({"Status": "Unknown request"}),
          { headers: { "Content-Type": "application/json" } },
          );
        }
      })
      
      