import { eq } from 'drizzle-orm';
import { db } from '~/server/db';
import { activities, photos, webhooks } from '~/server/db/schema';
import { handleWebhookActivity } from '~/server/strava/actions';
import type { WebhookRequest } from '~/types/strava';
import { NextRequest } from 'next/server';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ slug: string }> },
) {
  const params = await props.params;
  if (params.slug !== 'webhook')
    return new Response('Invalid endpoint', { status: 404 });

  const mode = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
    // Mark the webhook as verified in our database
    const webhookId = req.nextUrl.searchParams.get('webhook_id');
    if (webhookId) {
      await db
        .update(webhooks)
        .set({ verified: true })
        .where(eq(webhooks.id, parseInt(webhookId)));
    }

    return new Response(JSON.stringify({ 'hub.challenge': challenge }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Invalid verification token', { status: 403 });
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ slug: string }> },
) {
  const params = await props.params;
  console.log('Webhook received:', params.slug);

  if (params.slug !== 'webhook')
    return new Response('Invalid endpoint', { status: 404 });

  try {
    const data = (await req.json()) as WebhookRequest;
    console.log('Webhook data:', data);

    // Verify that this is a valid subscription from our database
    const subscription = await db.query.webhooks.findFirst({
      where: (webhooks, { eq, and }) =>
        and(
          eq(webhooks.id, data.subscription_id),
          eq(webhooks.verified, true),
          eq(webhooks.active, true),
        ),
    });

    if (!subscription) {
      console.error('Invalid subscription ID:', {
        received: data.subscription_id,
        subscription,
      });
      return new Response('Invalid subscription ID', { status: 403 });
    }

    if (data.object_type === 'athlete') {
      return new Response('OK');
    }

    if (data.aspect_type === 'delete') {
      await db.delete(activities).where(eq(activities.id, data.object_id));
      // Also delete associated photos
      await db.delete(photos).where(eq(photos.activity_id, data.object_id));
      return new Response(`Deleted activity ${data.object_id}`);
    }

    if (data.aspect_type === 'create' || data.aspect_type === 'update') {
      const {
        activities: [activity],
        photos,
      } = await handleWebhookActivity({
        activityId: data.object_id,
        athleteId: data.owner_id,
      });

      if (!activity) {
        throw new Error('No activity returned from Strava');
      }

      return new Response(
        `${data.aspect_type === 'create' ? 'Created' : 'Updated'} activity ${
          activity.id
        } with ${photos.length} photos`,
      );
    }

    return new Response('Invalid aspect type', { status: 400 });
  } catch (e) {
    console.error('Webhook request failed:', e);
    return new Response(
      e instanceof Error ? e.message : 'Unknown error processing webhook',
      { status: 500 },
    );
  }
}
