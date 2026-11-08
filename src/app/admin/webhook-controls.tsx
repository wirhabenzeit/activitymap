'use client';

import { useState, useTransition } from 'react';

import {
  checkWebhookStatus,
  createWebhookSubscription,
} from '~/server/strava/actions';

const button =
  'rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50';

/**
 * Operator controls for the Strava push subscription. Both server actions
 * call `requireAdmin()` themselves; this page being admin-only is not the
 * control. Registering replaces any subscription Strava has for another
 * callback URL (Strava allows one per app).
 */
export function WebhookControls() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const run = (action: () => Promise<string>) =>
    startTransition(async () => {
      try {
        setResult(await action());
      } catch (error) {
        setResult(error instanceof Error ? error.message : 'Request failed');
      }
    });

  const check = async () => {
    const status = await checkWebhookStatus();
    return status.hasMatchingSubscription
      ? `Registered at this deployment's callback (subscription ${status.matchingSubscription?.id}); database ${status.databaseStatus}.`
      : `No subscription for this deployment's callback.${status.otherSubscriptionCount > 0 ? ` ${status.otherSubscriptionCount} subscription for another URL; register to replace it.` : ''}`;
  };

  const register = async () => {
    const created = await createWebhookSubscription();
    return created.success
      ? `${created.message} (subscription ${created.subscription?.id}).`
      : (created.error ?? 'Registration failed');
  };

  return (
    <div className="space-y-2 px-3 py-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={() => run(check)}
        >
          Check status
        </button>
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={() => run(register)}
        >
          Register webhook
        </button>
      </div>
      <p role="status" className="text-muted-foreground">
        {pending ? 'Working…' : result}
      </p>
    </div>
  );
}
