import {AssistantResponse} from "./AssistantResponse";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  // Parse the request body
  const input: {
    threadId: string | null;
    message: string;
  } = await req.json();

  // Create a thread if needed
  const threadId =
    input.threadId ??
    (await openai.beta.threads.create({})).id;

  // Add a message to the thread
  const createdMessage =
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: input.message,
    });

  return AssistantResponse(
    {threadId, messageId: createdMessage.id},
    async ({forwardStream, sendDataMessage}) => {
      // Run the assistant on the thread
      const runStream = openai.beta.threads.runs.stream(
        threadId,
        {
          assistant_id:
            process.env.OPENAI_ASSISTANT_ID ??
            (() => {
              throw new Error("ASSISTANT_ID is not set");
            })(),
        }
      );
      /*runStream
        .on("textCreated", (text) =>
          console.log("\nassistant > ")
        )
        .on("textDelta", (textDelta, snapshot) =>
          console.log(textDelta.value)
        )
        .on("toolCallCreated", (toolCall) =>
          console.log(`\nassistant > ${toolCall.type}\n\n`)
        )
        .on("toolCallDelta", (toolCallDelta, snapshot) => {
          if (toolCallDelta.type === "code_interpreter") {
            if (toolCallDelta.code_interpreter.input) {
              console.log(
                toolCallDelta.code_interpreter.input
              );
            }
            if (toolCallDelta.code_interpreter.outputs) {
              console.log("\noutput >\n");
              toolCallDelta.code_interpreter.outputs.forEach(
                (output) => {
                  if (output.type === "logs") {
                    console.log(`\n${output.logs}\n`);
                  }
                }
              );
            }
          }
        });*/

      // forward run status would stream message deltas
      let runResult = await forwardStream(runStream);

      // status can be: queued, in_progress, requires_action, cancelling, cancelled, failed, completed, or expired
      while (
        runResult?.status === "requires_action" &&
        runResult.required_action?.type ===
          "submit_tool_outputs"
      ) {
        const tool_outputs =
          runResult.required_action.submit_tool_outputs.tool_calls.map(
            (toolCall: any) => {
              console.log(toolCall);
              const parameters = JSON.parse(
                toolCall.function.arguments
              );

              switch (toolCall.function.name) {
                // configure your tool calls here

                default:
                  throw new Error(
                    `Unknown tool call function: ${toolCall.function.name}`
                  );
              }
            }
          );

        runResult = await forwardStream(
          openai.beta.threads.runs.submitToolOutputsStream(
            threadId,
            runResult.id,
            {tool_outputs}
          )
        );
      }
    }
  );
}
