// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req: Request) => {
  console.log(req);
  const url = new URL(req.url);
  const args = Object.fromEntries(url.searchParams.entries());
  const url_req = args["url_req"];

  const response = await fetch(url_req);
  const content = await response.json();

  return new Response(
    JSON.stringify(content),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
});
