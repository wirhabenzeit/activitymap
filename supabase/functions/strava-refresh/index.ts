// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req: Request) => {
  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {auth: {
    autoRefreshToken: false,
    persistSession: false
  }});
  const { data, error } = await supabaseClient.from("strava-athletes").select("*")
  data.forEach ((async (athlete: any) => { 
    const response = await fetch(`https://www.strava.com/api/v3/oauth/token`, {
      method: "POST", 
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({'client_id': Deno.env.get('STRAVA_CLIENT_ID'), 'client_secret': Deno.env.get('STRAVA_CLIENT_SECRET'), 'refresh_token': athlete['refresh_token'], 'grant_type': 'refresh_token'}),
    });
    const json = await response.json();
    console.log(json);
    const { data2, error2 } = await supabaseClient.from("strava-athletes").upsert({access_token: json['access_token'], expires_at: json['expires_at'],'id': athlete['id']})
    console.log(data2,error2);
  }))
  return new Response(
    JSON.stringify({"Success": "Refreshed all athletes"}),
    { headers: { "Content-Type": "application/json" } },
  )
})