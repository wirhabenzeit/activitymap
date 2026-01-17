import { eq } from 'drizzle-orm';
import { db } from '~/server/db';
import { activities, photos, webhooks } from '~/server/db/schema';
import { fetchStravaActivities } from '~/server/strava/actions';
import { getAccountInternal } from '~/server/db/internal';
import type { WebhookRequest } from '~/types/strava';
import { type NextRequest } from 'next/server';

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
  console.log('Webhook POST received:', {
    slug: params.slug,
    method: req.method,
    headers: Object.fromEntries(req.headers.entries()),
  });

  if (params.slug !== 'webhook')
    return new Response('Invalid endpoint', { status: 404 });

  try {
    const data = (await req.json()) as WebhookRequest;
    console.log('Webhook payload:', {
      object_type: data.object_type,
      object_id: data.object_id,
      aspect_type: data.aspect_type,
      owner_id: data.owner_id,
      subscription_id: data.subscription_id,
      event_time: new Date(data.event_time * 1000).toISOString(),
      updates: data.updates,
    });

    // Verify that this is a valid subscription from our database
    const subscription = await db.query.webhooks.findFirst({
      where: (webhooks, { eq, and }) =>
        and(
          eq(webhooks.id, data.subscription_id),
          eq(webhooks.verified, true),
          eq(webhooks.active, true),
        ),
    });

    console.log('Subscription check:', {
      received_id: data.subscription_id,
      found: !!subscription,
      subscription_details: subscription
        ? {
          id: subscription.id,
          verified: subscription.verified,
          active: subscription.active,
          callback_url: subscription.callback_url,
        }
        : null,
    });

    if (!subscription) {
      console.error('Invalid subscription ID:', {
        received: data.subscription_id,
        subscription,
      });
      return new Response('Invalid subscription ID', { status: 403 });
    }

    if (data.object_type === 'athlete') {
      console.log('Received athlete webhook, skipping');
      return new Response('OK');
    }

    if (data.aspect_type === 'delete') {
      console.log('Processing delete webhook:', {
        activity_id: data.object_id,
        athlete_id: data.owner_id,
      });
      await db.delete(activities).where(eq(activities.id, data.object_id));
      // Also delete associated photos
      await db.delete(photos).where(eq(photos.activity_id, data.object_id));
      return new Response(`Deleted activity ${data.object_id}`);
    }

    if (data.aspect_type === 'create' || data.aspect_type === 'update') {
      console.log('Processing create/update webhook:', {
        activity_id: data.object_id,
        athlete_id: data.owner_id,
        aspect_type: data.aspect_type,
      });

      // Get account directly using Strava athlete ID
      const account = await getAccountInternal({
        providerAccountId: data.owner_id.toString(),
      });

      console.log('Account lookup result:', {
        found: !!account,
        athlete_id: data.owner_id,
        has_access_token: account?.access_token ? true : false,
        token_expires_at: account?.expires_at
          ? new Date(account.expires_at * 1000).toISOString()
          : null,
      });

      // If no account found, this user hasn't connected their Strava account to our app
      if (!account) {
        console.log('No account found for athlete ID:', data.owner_id);
        return new Response('No account found for this athlete', { status: 404 });
      }

      if (!account.access_token) {
        console.error('Account found but no access token present:', {
          athlete_id: data.owner_id,
          provider_account_id: account.providerAccountId,
        });
        return new Response('No Strava access token found', { status: 401 });
      }

      // This is a webhook call, so we're authorized by Strava directly
      const result = await fetchStravaActivities({
        accessToken: account.access_token,
        activityIds: [data.object_id],
        includePhotos: true,
        athleteId: data.owner_id,
        shouldDeletePhotos: true,
      });

      console.log('Webhook activity processing result:', {
        activity_count: result.activities.length,
        photo_count: result.photos.length,
        first_activity: result.activities[0]
          ? {
            id: result.activities[0].id,
            name: result.activities[0].name,
            is_complete: result.activities[0].is_complete,
          }
          : null,
      });

      if (!result.activities[0]) {
        throw new Error('No activity returned from Strava');
      }

      return new Response(
        `${data.aspect_type === 'create' ? 'Created' : 'Updated'} activity ${result.activities[0].id
        } with ${result.photos.length} photos`,
      );
    }

    return new Response('Invalid aspect type', { status: 400 });
  } catch (e) {
    console.error('Webhook request failed:', {
      error:
        e instanceof Error
          ? {
            message: e.message,
            name: e.name,
            stack: e.stack,
          }
          : e,
      timestamp: new Date().toISOString(),
    });
    return new Response(
      e instanceof Error ? e.message : 'Unknown error processing webhook',
      { status: 500 },
    );
  }
}
