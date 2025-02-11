import { Message, useAssistant } from 'ai/react';
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
} from '@mui/material';
import { Insights, SendOutlined } from '@mui/icons-material';
import { useState } from 'react';
import { useStore } from '~/store';
import { useShallow } from 'zustand/shallow';

export function ChatBot() {
  const [open, setOpen] = useState(false);
  const { selected, user, guest, session } = useStore(
    useShallow((state) => ({
      selected: state.selected,
      user: state.user,
      session: state.session,
      guest: state.guest,
    })),
  );

  if (!user || !session || guest) return null;

  const handleClickOpen = () => {
    setOpen(true);
  };

  return (
    <>
      <IconButton sx={{ mx: 0 }} onClick={handleClickOpen} size="small">
        <Insights sx={{ color: 'white', opacity: 0.9 }} />
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

function ChatBotDialog({ open, onClose, selected, user }) {
  const { status, messages, input, submitMessage, handleInputChange } =
    useAssistant({ api: '/api/assistant' });

  console.log(messages);

  return (
    <Dialog open={open} fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>Chat</DialogTitle>
      <div>
        {messages.map((m: Message) => (
          <div key={m.id}>
            <strong>{`${m.role}: `}</strong>
            {m.role !== 'data' && m.content}
            {m.role === 'data' && (
              <>
                {(m.data as any).description}
                <br />
                <pre className={'bg-gray-200'}>
                  {JSON.stringify(m.data, null, 2)}
                </pre>
              </>
            )}
          </div>
        ))}

        {status === 'in_progress' && <div />}

        <form onSubmit={submitMessage}>
          <input
            disabled={status !== 'awaiting_message'}
            value={input}
            placeholder="What is the temperature in the living room?"
            onChange={handleInputChange}
          />
        </form>
      </div>
    </Dialog>
  );
}
