"use server";

import {createStreamableValue} from "ai/rsc";
import {
  type CoreMessage,
  streamText,
  OpenAIStream,
} from "ai";
//import {openai, createOpenAI} from "@ai-sdk/openai";
import OpenAI from "openai";

const openai = new OpenAI();
export const createThread = async () => {
  return await openai.beta.threads.create();
};

export const createMessage = async (
  text: string,
  {
    threadID,
  }: {
    threadID: string;
  }
) => {
  const message = await openai.beta.threads.messages.create(
    threadID,
    {
      role: "user",
      content: text,
    }
  );
  const run = openai.beta.threads.runs.stream(threadID, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    instructions:
      "Please address the user as Jane Doe. The user has a premium account.",
  });
  /*if (run.status === "completed") {
    const messages =
      await openai.beta.threads.messages.list(
        run.thread_id
      );
    return messages.data.reverse();
  }
  return [];*/
  OpenAIStream(run);
};

/*export async function continueConversation(
  messages: CoreMessage[]
) {
  const result = await streamText({
    model: openai("asst_iMT1VRPZZNotIsd5NtXvjUAr"),
    messages,
  });

  const stream = createStreamableValue(result.textStream);
  return stream.value;
}*/
