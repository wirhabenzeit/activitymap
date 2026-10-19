/** A nonpersisted account lifetime; returning to the same user starts a new one. */
export type ActivityCommandSession = {
  userId: string;
  generation: number;
};

export type ActivityCommandAuthState = {
  authSession: number;
  isGuest: boolean;
  user?: { id: string; stravaConnected: boolean };
};

export function isActivityCommandSessionCurrent(
  session: ActivityCommandSession | null | undefined,
  state: ActivityCommandAuthState,
): boolean {
  return (
    !!session &&
    !state.isGuest &&
    state.user?.stravaConnected === true &&
    state.user.id === session.userId &&
    state.authSession === session.generation
  );
}

export const activityCommandAborted = () =>
  new DOMException('The library session changed', 'AbortError');

export class ActivityCommandBusyError extends Error {
  constructor() {
    super('An activity command is already in progress.');
    this.name = 'ActivityCommandBusyError';
  }
}

/** Account retirement and duplicate clicks have no user-facing failure notice. */
export function isSilentActivityCommandError(error: unknown): boolean {
  return (
    error instanceof ActivityCommandBusyError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

type AuthSource = {
  getState: () => ActivityCommandAuthState;
  subscribe: (listener: () => void) => () => void;
};

// Entries exist only for running commands, and each app/isolated renderer has
// its own owner. This is a command guard, never another library/cache writer.
const commands = new WeakMap<object, Map<string, AbortController>>();

/**
 * Claim before the first await so separate components and same-turn clicks
 * cannot overlap upstream writes. Duplicates are rejected, never queued: an
 * obsolete edit draft must not be submitted after another command completes.
 * Submitted work survives view unmounts; only account retirement cancels it.
 */
export async function runActivityCommand<T>(
  owner: object,
  session: ActivityCommandSession,
  activityId: number,
  auth: AuthSource,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!isActivityCommandSessionCurrent(session, auth.getState()))
    throw activityCommandAborted();
  let scoped = commands.get(owner);
  if (!scoped) {
    scoped = new Map();
    commands.set(owner, scoped);
  }
  const key = `${session.userId}\u0000${activityId}`;
  const previous = scoped.get(key);
  if (previous && !previous.signal.aborted)
    throw new ActivityCommandBusyError();
  const controller = new AbortController();
  scoped.set(key, controller);
  const unsubscribe = auth.subscribe(() => {
    if (!isActivityCommandSessionCurrent(session, auth.getState()))
      controller.abort(activityCommandAborted());
  });
  try {
    if (!isActivityCommandSessionCurrent(session, auth.getState()))
      controller.abort(activityCommandAborted());
    controller.signal.throwIfAborted();
    const result = await run(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    unsubscribe();
    if (scoped.get(key) === controller) {
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory command registry
      scoped.delete(key);
    }
  }
}
