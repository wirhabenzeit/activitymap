import { type NextRequest, NextResponse } from 'next/server';

import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import {
  webhookCallbackKeyMatches,
  webhookCallbackSecret,
} from '~/server/strava/webhook-callback';

import { handleWebhookDelivery, handleWebhookVerification } from '../handler';

type RouteContext = { params: Promise<{ key: string }> };

/**
 * The Strava webhook callback. The `[key]` segment must equal
 * `STRAVA_WEBHOOK_CALLBACK_SECRET` (constant-time); it is the only proof
 * that a delivery came from Strava, because Strava does not sign webhooks.
 * Every request with a missing or wrong key gets the same 404 the route
 * would give for an unknown path, before any body is read.
 */
async function authorize(context: RouteContext): Promise<NextResponse | null> {
  if (!externalEffectsEnabled()) {
    return new NextResponse(EXTERNAL_EFFECTS_DISABLED_MESSAGE, { status: 503 });
  }
  const secret = webhookCallbackSecret();
  if (!secret) {
    logger.error(
      '[Webhook] STRAVA_WEBHOOK_CALLBACK_SECRET is missing or malformed; rejecting delivery',
    );
    return new NextResponse('Not Found', { status: 404 });
  }
  const { key } = await context.params;
  if (!webhookCallbackKeyMatches(key, secret)) {
    return new NextResponse('Not Found', { status: 404 });
  }
  return null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return (await authorize(context)) ?? handleWebhookVerification(request);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return (await authorize(context)) ?? handleWebhookDelivery(request);
}
