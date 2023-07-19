// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req: Request) => {
  const url = new URL(req.url);
  const args = Object.fromEntries(url.searchParams.entries());
  const response = await fetch(`https://www.strava.com/api/v3/oauth/token`, {
      method: "POST", 
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({'client_id': Deno.env.get('STRAVA_CLIENT_ID'), 'client_secret': Deno.env.get('STRAVA_CLIENT_SECRET'), 'code': args["code"], 'grant_type': 'authorization_code'}),
    });
  const json = await response.json();
  if ("athlete" in json) {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {auth: {
      autoRefreshToken: false,
      persistSession: false
    }});
    const { data, error } = await supabaseClient.from("strava-athletes").select("*").eq("id", json["athlete"]["id"])
    if (data.length == 0) {
      return new Response(
        JSON.stringify({"Error": "Athlete not known"}),
        { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
        );
      }
      else {
        return new Response(
          JSON.stringify({"athlete": json['athlete']['id']}),
          { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
          );
      }
    }
    else { 
      return new Response(
        JSON.stringify({"Error": "No athlete in response"}),
        { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
        );
    }
})