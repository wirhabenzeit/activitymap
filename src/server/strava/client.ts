import type {
  StravaActivity,
  StravaPhoto,
  StravaSubscription,
  StravaError,
  UpdatableActivity,
} from './types';

const STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3';

export class StravaApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Array<{ resource: string; field: string; code: string }>,
  ) {
    super(message);
    this.name = 'StravaApiError';
  }
}

export class StravaClient {
  constructor(private accessToken: string) {}

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0,
  ): Promise<T> {
    console.log('Making Strava API request:', {
      endpoint,
      method: options.method || 'GET',
      hasAuthToken: !!this.accessToken,
      retryCount,
    });

    const response = await fetch(`${STRAVA_API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    console.log('Strava API response:', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    });

    if (!response.ok) {
      const error = (await response.json()) as StravaError;
      console.error('Strava API error:', {
        message: error.message,
        status: response.status,
        errors: error.errors,
      });

      // If we get a 401 and haven't retried yet, try to refresh the token
      if (response.status === 401 && retryCount === 0) {
        console.log('Got 401, forcing token refresh and retrying...');
        const { getAccount } = await import('~/server/db/actions');
        const account = await getAccount({ forceRefresh: true });
        if (!account) {
          throw new Error('No account found');
        }
        this.accessToken = account.access_token!;
        return this.request<T>(endpoint, options, retryCount + 1);
      }

      throw new StravaApiError(
        error.message ?? 'Unknown error',
        response.status,
        error.errors,
      );
    }

    return response.json() as Promise<T>;
  }

  async getActivity(id: number): Promise<StravaActivity> {
    return this.request<StravaActivity>(`/activities/${id}`);
  }

  async getActivities(
    params: {
      before?: number;
      after?: number;
      page?: number;
      per_page?: number;
      get_photos?: boolean;
    } = {},
  ): Promise<StravaActivity[]> {
    const searchParams = new URLSearchParams();
    if (params.before) searchParams.set('before', params.before.toString());
    if (params.after) searchParams.set('after', params.after.toString());
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.per_page)
      searchParams.set('per_page', params.per_page.toString());

    return this.request<StravaActivity[]>(
      `/athlete/activities?${searchParams}`,
    );
  }

  async updateActivity(
    id: number,
    data: Omit<UpdatableActivity, 'id' | 'athlete'>,
  ): Promise<StravaActivity> {
    return this.request<StravaActivity>(`/activities/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getActivityPhotos(
    id: number,
    size: number = 2048,
  ): Promise<StravaPhoto[]> {
    return this.request<StravaPhoto[]>(
      `/activities/${id}/photos?size=256,${size}&photo_sources=true`,
    );
  }

  async getSubscriptions(): Promise<StravaSubscription[]> {
    const clientId = process.env.AUTH_STRAVA_ID;
    const clientSecret = process.env.AUTH_STRAVA_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Missing Strava client credentials (AUTH_STRAVA_ID/AUTH_STRAVA_SECRET)',
      );
    }

    const searchParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    });

    return this.request<StravaSubscription[]>(
      `/push_subscriptions?${searchParams}`,
      {
        headers: {
          // No Authorization header needed for this endpoint
          Authorization: '',
        },
      },
    );
  }

  async createSubscription(
    callbackUrl: string,
    verifyToken: string,
  ): Promise<StravaSubscription> {
    const clientId = process.env.AUTH_STRAVA_ID;
    const clientSecret = process.env.AUTH_STRAVA_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Missing Strava client credentials (AUTH_STRAVA_ID/AUTH_STRAVA_SECRET)',
      );
    }

    return this.request<StravaSubscription>('/push_subscriptions', {
      method: 'POST',
      headers: {
        // No Authorization header needed for this endpoint
        Authorization: '',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        callback_url: callbackUrl,
        verify_token: verifyToken,
      }),
    });
  }

  async deleteSubscription(id: number): Promise<void> {
    const clientId = process.env.AUTH_STRAVA_ID;
    const clientSecret = process.env.AUTH_STRAVA_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Missing Strava client credentials (AUTH_STRAVA_ID/AUTH_STRAVA_SECRET)',
      );
    }

    const searchParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    });

    await this.request(`/push_subscriptions/${id}?${searchParams}`, {
      method: 'DELETE',
      headers: {
        // No Authorization header needed for this endpoint
        Authorization: '',
      },
    });
  }
}
