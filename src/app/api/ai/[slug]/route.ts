import {NextRequest, NextResponse} from "next/server";
import OpenAI from "openai";

// this enables Edge Functions in Vercel
// see https://vercel.com/blog/gpt-3-app-next-js-vercel-edge-functions
// and updated here: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
export const runtime = "edge";

// post a new message and stream OpenAI Assistant response
export async function POST(request: NextRequest, props: {params: Promise<{slug: string}>}) {
  const params = await props.params;
  const openai = new OpenAI();
  if (params.slug == "message") {
    const newMessage = await request.json();

    // if no thread id then create a new openai thread
    if (newMessage.threadId == null) {
      const thread = await openai.beta.threads.create();
      newMessage.threadId = thread.id;
    }

    // add new message to thread
    await openai.beta.threads.messages.create(
      newMessage.threadId,
      {
        role: "user",
        content: newMessage.content,
        attachments: newMessage.attachments,
      }
    );

    // create a run
    const stream = await openai.beta.threads.runs.create(
      newMessage.threadId,
      {assistant_id: newMessage.assistantId, stream: true}
    );

    return new Response(stream.toReadableStream());
  }

  if (params.slug == "file") {
    if (!request.nextUrl.searchParams.has("session"))
      return new Response("Not authenticated", {
        status: 401,
      });
    const csvfile = await fetch(
      `${request.nextUrl.origin}/api/db?session=${request.nextUrl.searchParams.get("session")}`
    );
    const data = await csvfile.text();
    const blob = new Blob([data], {type: "text/csv"});
    const file = new File([blob], "data.csv");
    const file_openai = await openai.files.create({
      file: file,
      purpose: "assistants",
    });
    return Response.json(file_openai);
  }

  if (params.slug == "image") {
    if (!request.nextUrl.searchParams.has("fileID"))
      return new Response("No file ID", {status: 400});
    const fileID =
      request.nextUrl.searchParams.get("fileID");
    const image = await openai.files.content(fileID!);
    const file = new File(
      [await image.blob()],
      "image.png"
    );
    return new Response(file);
  }
}

export async function GET(request: NextRequest, props: {params: Promise<{slug: string}>}) {
  const params = await props.params;
  const openai = new OpenAI();
  if (params.slug == "image") {
    if (!request.nextUrl.searchParams.has("fileID"))
      return new Response("No file ID", {status: 400});
    const fileID =
      request.nextUrl.searchParams.get("fileID");
    const image = await openai.files.content(fileID!);
    const file = new File(
      [await image.blob()],
      "image.png"
    );
    return new Response(file);
  }
  return new Response("Invalid endpoint", {status: 404});
}
