// One open/closed flag for the single Settings dialog, so every account entry
// point opens the same instance. React-free on purpose.

let open = false;
const listeners = new Set<() => void>();

export const settingsDialogState = {
  get: () => open,
  set: (next: boolean) => {
    if (open === next) return;
    open = next;
    for (const listener of [...listeners]) listener();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const openSettingsDialog = () => settingsDialogState.set(true);
