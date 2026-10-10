'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, X } from 'lucide-react';
import { useShallowStore } from '~/store';
import type { InitialImportDTO } from '~/contracts/v1/initial-import';
import {
  InitialImportError,
  initialImportFinished,
  runInitialImport,
} from '~/lib/sync/initial-import';

// Preserve HTTP cooldowns across remounts and Strict Mode; never share them across accounts.
const retryDeadlines = new Map<string, number>();

export function InitialImportNotice() {
  const { userId, connected } = useShallowStore((state) => ({
    userId: !state.isGuest && state.isInitialized ? state.user?.id : undefined,
    connected:
      state.user?.stravaConnected &&
      state.user?.stravaPermissions?.activities !== 'none',
  }));
  const client = useQueryClient();
  const [progress, setProgress] = useState<{
    userId: string;
    status: InitialImportDTO;
  } | null>(null);
  const [failure, setFailure] = useState<{
    userId: string;
    message: string;
  } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [time, setTime] = useState(0);
  const lastProgress = useRef<{
    userId: string;
    status: InitialImportDTO;
  } | null>(null);

  useEffect(() => {
    if (!userId || !connected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (controller.signal.aborted || !navigator.onLine) return;
      const retryAt = retryDeadlines.get(userId) ?? 0;
      if (retryAt > Date.now()) {
        timer = setTimeout(
          () => {
            setTime(Date.now());
            void run();
          },
          Math.min(60_000, retryAt - Date.now()),
        );
        return;
      }
      setRunning(userId);
      setFailure(null);
      try {
        const refreshActivities = async () => {
          if (controller.signal.aborted) return;
          await client.invalidateQueries({
            predicate: (query) =>
              query.queryKey[0] === 'activities' &&
              query.queryKey[2] === userId,
          });
          if (!controller.signal.aborted)
            window.dispatchEvent(new Event('activitymap:retry-browser-sync'));
        };
        const result = await runInitialImport({
          signal: controller.signal,
          onProgress: (status) => {
            lastProgress.current = { userId, status };
            setProgress({ userId, status });
            if (status.retryAt)
              retryDeadlines.set(userId, Date.parse(status.retryAt));
            else retryDeadlines.set(userId, 0);
          },
          onBatch: refreshActivities,
        });
        if (!controller.signal.aborted && initialImportFinished(result)) {
          // Another client may have finished since this notice last published.
          // Keep a returning user's first completed GET invisible.
          if (
            lastProgress.current?.userId === userId &&
            !initialImportFinished(lastProgress.current.status)
          ) {
            await refreshActivities();
          }
          if (controller.signal.aborted) return;
          setProgress((previous) =>
            previous?.userId === userId ? { userId, status: result } : previous,
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        retryDeadlines.set(
          userId,
          error instanceof InitialImportError
            ? error.retryAt
            : Date.now() + 60_000,
        );
        setFailure({
          userId,
          message:
            error instanceof Error
              ? error.message
              : 'Could not import your activities. Try again.',
        });
      } finally {
        if (!controller.signal.aborted) setRunning(null);
      }
    };
    // An interrupted/concurrent import is revisited on foreground/reconnect.
    const online = () => {
      setAttempt((value) => value + 1);
    };
    const visible = () => {
      if (!document.hidden) online();
    };
    void run();
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userId, connected, client, attempt]);

  useEffect(() => {
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!userId || !connected || dismissed === userId) return null;
  const status =
    progress?.userId === userId
      ? progress.status
      : failure?.userId === userId
        ? {
            phase: 'failed' as const,
            importedCount: 0,
            target: 200,
            historyComplete: false,
            retryAt: null,
            message: failure.message,
          }
        : null;
  if (!status) return null;
  const finished = initialImportFinished(status);
  const busy = running === userId;
  const error = failure?.userId === userId ? failure.message : status.message;
  const retryAt = retryDeadlines.get(userId) ?? 0;
  const waiting = retryAt > time;
  const title =
    status.phase === 'empty'
      ? 'No activities found in Strava'
      : finished
        ? 'Your recent activities are ready'
        : error
          ? 'Activity import paused'
          : 'Bringing in your recent activities';
  return (
    <section
      className="mx-3 mb-3 shrink-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
      aria-label="Initial activity import"
    >
      <div className="flex items-start gap-3">
        {busy && (
          <LoaderCircle
            className="mt-0.5 h-5 w-5 shrink-0 motion-safe:animate-spin"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium" role="status">
            {title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error ??
              (status.phase === 'empty'
                ? 'New activities will appear here after you record them in Strava.'
                : finished
                  ? `${status.importedCount} activities imported. ${status.historyComplete ? 'Details and photos' : 'Older history, details and photos'} continue automatically.`
                  : `${status.importedCount} of up to ${status.target} recent activities imported. You can start exploring as they arrive.`)}
          </p>
          {!finished && (
            <progress
              className="mt-3 h-2 w-full accent-primary"
              max={status.target}
              value={status.importedCount}
              aria-label="Recent activities imported"
            />
          )}
          {!finished && !busy && (
            <button
              type="button"
              className="mt-2 min-h-11 text-sm font-medium underline disabled:opacity-50"
              disabled={waiting}
              onClick={() => setAttempt((value) => value + 1)}
            >
              {waiting
                ? 'Waiting to retry'
                : error
                  ? 'Retry import'
                  : 'Continue import'}
            </button>
          )}
        </div>
        {finished && (
          <button
            type="button"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md"
            aria-label="Dismiss import message"
            onClick={() => setDismissed(userId)}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </section>
  );
}
