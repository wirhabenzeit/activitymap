// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req: Request) => {
  const url = new URL(req.url);
  const args = Object.fromEntries(url.searchParams.entries());
  const id = args["id"]
  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {auth: {
    autoRefreshToken: false,
    persistSession: false
  }});
  const { data, error } = await supabaseClient.from("strava-athletes").select("*").eq("id", id)
  if (data.length == 0) {
    return new Response(
      JSON.stringify({"Error": "Athlete not known"}),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
  }
  else {
    const response = await fetch(`https://www.strava.com/api/v3/athlete`, {headers: {'Authorization': "Bearer " + data[0]['access_token']}});
    const json = await response.json();
    return new Response(
      JSON.stringify(json),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
  }
})