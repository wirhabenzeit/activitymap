"use client";

import {OpenAI} from "openai";
import Markdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter";
import {
  docco,
  dark,
} from "react-syntax-highlighter/dist/esm/styles/hljs";

import {AssistantStream} from "openai/lib/AssistantStream";

import {useEffect, useState, useRef} from "react";
import {
  IconButton,
  TextField,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormGroup,
  List,
  ListItem,
  Grid,
  ListItemText,
  CircularProgress,
} from "@mui/material";
import {Insights, SendOutlined} from "@mui/icons-material";

import {useStore} from "~/contexts/Zustand";
import {type User} from "~/server/db/schema";
import {useShallow} from "zustand/shallow";

export function ChatBot() {
  const [open, setOpen] = useState(false);
  const {selected, user, guest, session} = useStore(
    useShallow((state) => ({
      selected: state.selected,
      user: state.user,
      session: state.session,
      guest: state.guest,
    }))
  );

  if (!user || !session || guest) return null;

  const handleClickOpen = () => {
    setOpen(true);
  };

  return (
    <>
      <IconButton
        sx={{mx: 0}}
        onClick={handleClickOpen}
        size="small"
      >
        <Insights sx={{color: "white", opacity: 0.9}} />
      </IconButton>
      <ChatBotDialog
        open={open}
        onClose={() => setOpen(false)}
        selected={selected}
        user={user}
      />
    </>
  );
}

interface ChatBotDialogProps {
  open: boolean;
  onClose: () => void;
  selected: number[];
  user: User;
}

function ChatBotDialog({
  open,
  onClose,
  selected,
  user,
}: ChatBotDialogProps) {
  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="md"
      onClose={onClose}
    >
      <DialogTitle>Chat</DialogTitle>
      <OpenAIAssistant
        assistantId="asst_iMT1VRPZZNotIsd5NtXvjUAr"
        greeting="What do you want to know about your activities?"
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

interface OpenAIAssistantProps {
  assistantId: string;
  greeting: string;
}

type FileAPIResponse = {
  object: "file";
  id: string;
  purpose: string;
  filename: string;
  bytes: number;
  created_at: number;
  status: string;
  status_details: null;
};

function OpenAIAssistant({
  assistantId,
  greeting,
}: OpenAIAssistantProps) {
  const streamingCodeRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [threadId, setThreadId] = useState<string | null>(
    null
  );
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] =
    useState<Message | null>(null);
  const [streamingCode, setStreamingCode] =
    useState<OpenAI.Beta.Threads.Runs.Steps.ToolCall | null>(
      null
    );
  const messageId = useRef(0);
  const endOfMessagesRef = useRef(null);

  const greetingMessage: Message = {
    id: "greeting",
    role: "assistant",
    content: greeting,
    createdAt: new Date(),
  };

  const session = useStore((state) => state.session);

  const uploadFile = async () => {
    if (!session) return;
    const sessionToken = session.sessionToken;
    const fileResponse = await fetch(
      `/api/ai/file?session=${sessionToken}`,
      {
        method: "POST",
      }
    );
    const file =
      (await fileResponse.json()) as FileAPIResponse;
    const fileID = file.id;
    const response = await fetch("/api/ai/message", {
      method: "POST",
      body: JSON.stringify({
        assistantId,
        threadId,
        content:
          "This is the CSV containing all my activity data. Do not reply yet, wait for me to ask a question.",
        attachments: [
          {
            file_id: fileID,
            tools: [{type: "code_interpreter"}],
          },
        ],
      }),
    });
    console.log(response);
    if (!response.body) return;
    const runner = AssistantStream.fromReadableStream(
      response.body
    );
    runner.on("messageCreated", (message) => {
      setThreadId(message.thread_id);
      setIsLoading(false);
    });
  };

  useEffect(() => {
    // upload a file to OpenAI
    void uploadFile();
  }, []);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [
    messages,
    isLoading,
    streamingMessage,
    streamingCode,
  ]);

  const handlePromptChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setPrompt(e.target.value);
  };

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();
    setStreamingMessage({
      id: "Thinking...",
      role: "assistant",
      content: "_Thinking..._",
      createdAt: new Date(),
    });
    setIsLoading(true);

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

    const response = await fetch("/api/ai/message", {
      method: "POST",
      body: JSON.stringify({
        assistantId,
        threadId,
        content: prompt,
      }),
    });

    setPrompt("");

    if (!response.body) return;

    const runner = AssistantStream.fromReadableStream(
      response.body
    );
    runner.on("messageCreated", (message) =>
      setThreadId(message.thread_id)
    );
    runner.on("textDelta", (_delta, contentSnapshot) =>
      setStreamingMessage({
        ...streamingMessage,
        content: contentSnapshot.value,
      })
    );
    runner.on("messageDone", (message) => {
      const finalContent =
        message.content[0].type === "text"
          ? message.content[0].text.value
          : "";
      messageId.current++;
      const newMessage = {
        id: messageId.current.toString(),
        role: "assistant",
        content: finalContent,
        createdAt: new Date(),
      };
      console.log("new Message", newMessage);
      setMessages((prevMessages) => [
        ...prevMessages,
        newMessage,
      ]);
      setIsLoading(false);
    });

    runner.on("toolCallCreated", (toolCall) => {
      if (toolCall.type === "code_interpreter")
        setStreamingCode(toolCall);
    });

    runner.on("toolCallDelta", (delta) => {
      if (delta.type !== "code_interpreter") return;
      setStreamingCode((toolCall) => {
        let input = toolCall
          ? toolCall.code_interpreter.input
          : "";
        let outputs = toolCall
          ? toolCall.code_interpreter.outputs
          : [];
        if (delta.code_interpreter.input)
          input += delta.code_interpreter.input;
        if (delta.code_interpreter.outputs)
          outputs = outputs.concat(
            delta.code_interpreter.outputs
          );
        const newStreamingCode = {
          ...delta,
          code_interpreter: {input, outputs},
        };
        streamingCodeRef.current = newStreamingCode;
        return newStreamingCode;
      });
    });

    runner.on("toolCallDone", (toolCall) => {
      if (toolCall.type === "code_interpreter") {
        messageId.current++;
        const newMessage = {
          ...streamingCodeRef.current,
          id: messageId.current.toString(),
        };
        console.log("new Code", newMessage);
        setMessages((prevMessages) => [
          ...prevMessages,
          newMessage,
        ]);
        setStreamingCode(null);
        streamingCodeRef.current = null;
      }
    });

    runner.on("error", (error) => console.error(error));
  };

  return (
    <>
      <DialogContent dividers>
        <List>
          <OpenAIAssistantMessage
            message={greetingMessage}
          />
          {messages.map((m) => (
            <ListItem key={m.id}>
              <OpenAIAssistantMessage message={m} />
            </ListItem>
          ))}
          {isLoading && streamingMessage && (
            <ListItem key="streamingMessage">
              <OpenAIAssistantMessage
                message={streamingMessage}
              />
            </ListItem>
          )}
          {isLoading && streamingCode && (
            <ListItem key="streamingCode">
              <OpenAIAssistantMessage
                message={streamingCode}
              />
            </ListItem>
          )}
          <div ref={endOfMessagesRef} />
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
            <IconButton
              disabled={isLoading || prompt.length === 0}
              variant="contained"
              color="primary"
              type="submit"
            >
              {isLoading ? (
                <CircularProgress />
              ) : (
                <SendOutlined />
              )}
            </IconButton>
          </FormGroup>
        </form>
      </DialogActions>
    </>
  );
}

function OpenAIAssistantMessage({message}) {
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
          />
        </Grid>
      )}
      {"type" in message &&
        message.type === "code_interpreter" && (
          <Grid item xs={12}>
            <ListItemText
              align="left"
              primary={
                <SyntaxHighlighter
                  language="python"
                  style={dark}
                  customStyle={{fontSize: ".8rem"}}
                >
                  {message.code_interpreter.input}
                </SyntaxHighlighter>
              }
            />
          </Grid>
        )}
      {"type" in message &&
        message.type === "code_interpreter" &&
        message.code_interpreter.outputs.map((output, i) =>
          output.type === "logs" ? (
            <Grid item xs={12} key={i}>
              <ListItemText
                align="left"
                primary={
                  <SyntaxHighlighter
                    language="shell"
                    style={docco}
                    customStyle={{fontSize: ".8rem"}}
                  >
                    {output.logs}
                  </SyntaxHighlighter>
                }
              />
            </Grid>
          ) : output.type === "image" ? (
            <Grid item xs={12} key={i}>
              <ListItemText
                align="left"
                primary={
                  <img
                    src={`/api/ai/image?fileID=${output.image.file_id}`}
                    alt="AI generated image"
                    style={{maxWidth: "100%"}}
                  />
                }
              />
            </Grid>
          ) : null
        )}
    </Grid>
  );
}
