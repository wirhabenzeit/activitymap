// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req: Request) => {
  console.log(Deno.env.get('STRAVA_CLIENT_ID'))
  const url = new URL(req.url);
  const args = Object.fromEntries(url.searchParams.entries());
  const body = JSON.stringify({'client_id': Deno.env.get('STRAVA_CLIENT_ID'), 'client_secret': Deno.env.get('STRAVA_CLIENT_SECRET'), 'code': args["code"], 'grant_type': 'authorization_code'})
  console.log("Sending request to Strava with body: ", body)
  const response = await fetch(`https://www.strava.com/api/v3/oauth/token`, {
      method: "POST", 
      headers: {
        "Content-Type": "application/json",
      },
      body: body,
    });
  const json = await response.json();
  console.log(json);
  if ("athlete" in json) {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {auth: {
      autoRefreshToken: false,
      persistSession: false
    }});
      const { data2, error2 } = await supabaseClient.from("strava-athletes").upsert({access_token: json['access_token'], expires_at: json['expires_at'],'id': json['athlete']['id'], 'refresh_token': json['refresh_token']})
      const {data3, error3 } = await supabaseClient.from("strava-athletes-profile").upsert({'id': json['athlete']['id'], 'first_name': json['athlete']['firstname'], 'last_name': json['athlete']['firstname'], "profile_medium": json.athlete.profile_medium }).eq("id", json["athlete"]["id"])
      return new Response(
        JSON.stringify({"athlete": json['athlete']['id'] }),
        { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
        );
    }
    else { 
      return new Response(
        JSON.stringify({"Error": "No athlete in response"}),
        { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
        );
    }
})