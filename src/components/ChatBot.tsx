"use client";

import {type CoreMessage} from "ai";

import {OpenAI} from "openai";
//import {continueConversation} from "~/server/ai/actions";
import Markdown from "react-markdown";
//import {readStreamableValue} from "ai/rsc";

import {AssistantStream} from "openai/lib/AssistantStream";
import {
  AiOutlineUser,
  AiOutlineRobot,
  AiOutlineSend,
} from "react-icons/ai";

import {useEffect, useState, useRef} from "react";
import {
  IconButton,
  TextField,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Switch,
  FormGroup,
  Button,
  FormControlLabel,
  Snackbar,
  type SnackbarCloseReason,
  List,
  ListItem,
  Grid,
  ListItemText,
  FormControl,
  Input,
  CircularProgress,
} from "@mui/material";
import {
  IosShare as ShareIcon,
  Link as LinkIcon,
  Close as CloseIcon,
  Insights,
  SendOutlined,
} from "@mui/icons-material";
import {library} from "@fortawesome/fontawesome-svg-core";
import {fas} from "@fortawesome/free-solid-svg-icons";
library.add(fas);

import {useStore} from "~/contexts/Zustand";
import {type User} from "~/server/db/schema";

export function ChatBot() {
  const [open, setOpen] = useState(false);

  const handleClickOpen = () => {
    setOpen(true);
  };
  const {selected, user, guest} = useStore((state) => ({
    selected: state.selected,
    user: state.user,
    guest: state.guest,
  }));

  if (!user || guest) return null;
  return (
    <>
      <IconButton sx={{mx: 2}} onClick={handleClickOpen}>
        <Insights sx={{color: "white", opacity: 0.9}} />
      </IconButton>
      <ChatBotDialog
        dialogOpen={open}
        setDialogOpen={setOpen}
        selected={selected}
        user={user}
      />
    </>
  );
}

import {
  createThread,
  createMessage,
} from "~/server/ai/actions";
import {ne} from "drizzle-orm";

function ChatBotDialog({
  dialogOpen,
  setDialogOpen,
  selected,
  user,
}: {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  selected: number[];
  user: User;
}) {
  return (
    <Dialog
      open={dialogOpen}
      fullWidth={true}
      maxWidth="md"
      onClose={() => setDialogOpen(false)}
      slotProps={{backdrop: {style: {opacity: 0.1}}}}
    >
      <OpenAIAssistant
        assistantId="asst_iMT1VRPZZNotIsd5NtXvjUAr"
        greeting="HELLO MR RIPLEY"
      />
    </Dialog>
  );
}

interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

interface CodeInterpreterInput {
  type: "code_interpreter";
  index: number;
  code_interpreter: {input: string; outputs?: unknown[]};
}

export default function OpenAIAssistant({
  assistantId = "",
  greeting = "I am a helpful chat assistant. How can I help you?",
}) {
  const streamingCodeRef = useRef(null);

  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(
    null
  );
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<
    (
      | OpenAI.Beta.Threads.Messages.Message
      | OpenAI.Beta.Threads.Runs.Steps.ToolCall
    )[]
  >([]);
  const [streamingMessage, setStreamingMessage] =
    useState<Message>({
      id: "Thinking...",
      role: "assistant",
      content: "_Thinking..._",
      createdAt: new Date(),
    });
  const [streamingCode, setStreamingCode] =
    useState<OpenAI.Beta.Threads.Runs.Steps.ToolCall | null>(
      null
    );

  const messageId = useRef(0);

  // set default greeting Message
  const greetingMessage = {
    id: "greeting",
    role: "assistant",
    content: greeting,
    createdAt: new Date(),
  };

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    // clear streaming message
    setStreamingMessage({
      id: "Thinking...",
      role: "assistant",
      content: "_Thinking..._",
      createdAt: new Date(),
    });

    // add busy indicator
    setIsLoading(true);

    // add user message to list of messages
    messageId.current++;
    setMessages((prev) => [
      ...prev,
      {
        id: messageId.current.toString(),
        role: "user",
        content: prompt,
        createdAt: new Date(),
      },
    ]);
    setPrompt("");

    // post new message to server and stream OpenAI Assistant response
    const response = await fetch("/api/ai", {
      method: "POST",
      body: JSON.stringify({
        assistantId: assistantId,
        threadId: threadId,
        content: prompt,
      }),
    });

    if (!response.body) {
      return;
    }

    const runner = AssistantStream.fromReadableStream(
      response.body
    );

    runner.on("messageCreated", (message) => {
      setThreadId(message.thread_id);
    });

    runner.on("textDelta", (_delta, contentSnapshot) => {
      const newStreamingMessage = {
        ...streamingMessage,
        content: contentSnapshot.value,
      };
      setStreamingMessage(newStreamingMessage);
    });

    runner.on("messageDone", (message) => {
      // get final message content
      const finalContent =
        message.content[0].type == "text"
          ? message.content[0].text.value
          : "";

      // add assistant message to list of messages
      messageId.current++;
      console.log({
        id: messageId.current.toString(),
        role: "assistant",
        content: finalContent,
        createdAt: new Date(),
      });
      console.log("adding msg", {
        id: messageId.current.toString(),
        role: "assistant",
        content: finalContent,
        createdAt: new Date(),
      });
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          id: messageId.current.toString(),
          role: "assistant",
          content: finalContent,
          createdAt: new Date(),
        },
      ]);
      setIsLoading(false);
    });

    runner.on("toolCallCreated", (toolCall) => {
      console.log(toolCall);
      if (toolCall.type === "code_interpreter")
        setStreamingCode(toolCall);
    });

    runner.on("toolCallDelta", (delta) => {
      if (delta.type !== "code_interpreter") return;
      setStreamingCode((toolcall) => {
        let input, outputs;
        if (toolcall) {
          input = toolcall.code_interpreter.input;
          outputs = toolcall.code_interpreter.outputs;
        } else {
          input = "";
          outputs = [];
        }
        if ("input" in delta.code_interpreter)
          input += delta.code_interpreter.input;
        if ("outputs" in delta.code_interpreter)
          outputs = outputs.concat(
            delta.code_interpreter.outputs
          );
        const newStreamingCode = {
          ...delta,
          code_interpreter: {
            input,
            outputs,
          },
        };
        streamingCodeRef.current = newStreamingCode;
        return newStreamingCode;
      });
    });

    runner.on(
      "toolCallDone",
      (
        toolCall: OpenAI.Beta.Threads.Runs.Steps.ToolCall
      ) => {
        if (toolCall.type === "code_interpreter") {
          messageId.current++;
          console.log(
            "adding msg",
            streamingCodeRef.current
          );
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              ...streamingCodeRef.current,
              id: messageId.current.toString(),
            },
          ]);
          setStreamingCode(null);
          streamingCodeRef.current = null;
        }
      }
    );

    runner.on("error", (error) => {
      console.error(error);
    });
  }

  // handles changes to the prompt input field
  function handlePromptChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    setPrompt(e.target.value);
  }

  return (
    <>
      <DialogTitle>Chat</DialogTitle>
      <DialogContent dividers={true}>
        <List>
          <OpenAIAssistantMessage
            message={greetingMessage}
          />
          {messages.map((m, i) => (
            <ListItem key={i}>
              <OpenAIAssistantMessage
                key={m.id}
                message={m}
              />
            </ListItem>
          ))}
          {isLoading && (
            <ListItem key="streamingMessage">
              {streamingMessage !== null && (
                <OpenAIAssistantMessage
                  message={streamingMessage}
                />
              )}
              {streamingCode !== null && (
                <OpenAIAssistantMessage
                  message={streamingCode}
                />
              )}
            </ListItem>
          )}
        </List>
      </DialogContent>
      <DialogActions>
        <form
          onSubmit={handleSubmit}
          style={{width: "100%"}}
        >
          <FormGroup
            sx={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "nowrap",
              width: "100%",
            }}
          >
            <TextField
              disabled={isLoading}
              autoFocus
              fullWidth
              onChange={handlePromptChange}
              value={prompt}
              sx={{flexGrow: 1}}
              placeholder="What would you like to know?"
            />
            {isLoading ? (
              <IconButton
                disabled
                variant="contained"
                color="primary"
              >
                <CircularProgress />
              </IconButton>
            ) : (
              <IconButton
                disabled={prompt.length === 0}
                variant="contained"
                color="primary"
              >
                <SendOutlined />
              </IconButton>
            )}
          </FormGroup>
        </form>
      </DialogActions>
    </>
  );
}

export function OpenAIAssistantMessage({
  message,
}: {
  message:
    | OpenAI.Beta.Threads.Messages.Message
    | OpenAI.Beta.Threads.Runs.Steps.ToolCall;
}) {
  //console.log(message);
  return (
    <Grid container>
      {"role" in message && (
        <Grid item xs={12}>
          <ListItemText
            align={
              message.role === "user" ? "right" : "left"
            }
            primary={<Markdown>{message.content}</Markdown>}
            secondary={message.createdAt.toLocaleTimeString()}
          ></ListItemText>
        </Grid>
      )}
      {"type" in message &&
        message.type === "code_interpreter" && (
          <Grid item xs={12}>
            <ListItemText
              align="left"
              primary={
                <Markdown>
                  {`\`\`\`python\n${message.code_interpreter.input}\n\`\`\``}
                </Markdown>
              }
            ></ListItemText>
          </Grid>
        )}
    </Grid>
  );
}
