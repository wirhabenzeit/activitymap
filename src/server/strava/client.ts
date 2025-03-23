import type {
  StravaActivity,
  StravaPhoto,
  StravaSubscription,
  StravaError,
  UpdatableActivity,
} from './types';
import { mergeAndProcessStravaPhotos } from './transforms';

const STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3';
const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
}

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
  private accessToken?: string;
  private refreshToken?: string;
  private clientId: string;
  private clientSecret: string;
  private tokenRefreshCallback?: (tokens: StravaTokens) => Promise<void>;

  private constructor({
    accessToken,
    refreshToken,
    tokenRefreshCallback,
  }: {
    accessToken?: string;
    refreshToken?: string;
    tokenRefreshCallback?: (tokens: StravaTokens) => Promise<void>;
  }) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenRefreshCallback = tokenRefreshCallback;

    // Parse environment variables for client credentials
    const clientId = process.env.AUTH_STRAVA_ID;
    const clientSecret = process.env.AUTH_STRAVA_SECRET;

    // Always validate credentials
    if (!clientId || !clientSecret) {
      throw new Error(
        'Missing Strava client credentials (AUTH_STRAVA_ID/AUTH_STRAVA_SECRET)',
      );
    }

    // Now we know these are non-null
    this.clientId = clientId;
    this.clientSecret = clientSecret;

    console.log('StravaClient initialized:', {
      hasAccessToken: !!this.accessToken,
      hasRefreshToken: !!this.refreshToken,
      hasClientCredentials: !!(this.clientId && this.clientSecret),
      accessTokenLength: this.accessToken ? this.accessToken.length : 0,
    });
  }

  /**
   * Create a StravaClient with an access token for authenticated user operations
   */
  static withAccessToken(accessToken: string): StravaClient {
    return new StravaClient({ accessToken });
  }

  /**
   * Create a StravaClient with a refresh token that can refresh access tokens
   */
  static withRefreshToken(
    refreshToken: string,
    tokenRefreshCallback: (tokens: StravaTokens) => Promise<void>,
  ): StravaClient {
    return new StravaClient({ refreshToken, tokenRefreshCallback });
  }

  /**
   * Create a StravaClient with both access and refresh tokens
   */
  static withTokens(
    accessToken: string,
    refreshToken: string,
    tokenRefreshCallback: (tokens: StravaTokens) => Promise<void>,
  ): StravaClient {
    return new StravaClient({
      accessToken,
      refreshToken,
      tokenRefreshCallback,
    });
  }

  /**
   * Create a StravaClient for operations that don't require user authentication
   * (like webhook management)
   */
  static withoutAuth(): StravaClient {
    return new StravaClient({});
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<StravaTokens> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    console.log('Refreshing access token...');

    try {
      const response = await fetch(STRAVA_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }),
      });

      const tokens = (await response.json()) as StravaTokens;
      console.log('Token refresh response:', {
        status: response.status,
        ok: response.ok,
        tokens: {
          expires_in: tokens.expires_in,
          expires_at: tokens.expires_at,
          has_access_token: !!tokens.access_token,
          has_refresh_token: !!tokens.refresh_token,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh access token: ${response.status}`);
      }

      // Update internal tokens
      this.accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        this.refreshToken = tokens.refresh_token;
      }

      // Call the callback if provided
      if (this.tokenRefreshCallback) {
        await this.tokenRefreshCallback(tokens);
      }

      return tokens;
    } catch (error) {
      console.error('Error refreshing access token:', error);
      throw new Error('Failed to refresh access token');
    }
  }

  /**
   * Ensure we have a valid access token, refreshing if necessary
   */
  private async ensureValidAccessToken(): Promise<string> {
    if (!this.accessToken && this.refreshToken) {
      // If we have a refresh token but no access token, refresh
      const tokens = await this.refreshAccessToken();
      return tokens.access_token;
    } else if (!this.accessToken) {
      throw new Error('No access token available');
    }

    return this.accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0,
  ): Promise<T> {
    // Determine if this is a webhook endpoint (which doesn't need auth)
    const isWebhookEndpoint = endpoint.includes('/push_subscriptions');

    // Get authorization header based on endpoint type
    let authHeader = '';
    if (!isWebhookEndpoint) {
      try {
        // Only try to get an access token for non-webhook endpoints
        const token = await this.ensureValidAccessToken();
        authHeader = `Bearer ${token}`;
      } catch (error) {
        // For webhook endpoints, we'll proceed without auth
        // For other endpoints, we need to throw
        if (!isWebhookEndpoint) {
          throw error;
        }
      }
    }

    console.log('Making Strava API request:', {
      endpoint,
      method: options.method ?? 'GET',
      hasAuthToken: !!authHeader,
      isWebhookEndpoint,
      retryCount,
      bodyType: options.body instanceof FormData ? 'FormData' : typeof options.body,
    });

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    
    // Only set Content-Type to application/json if we're not sending FormData
    // FormData will automatically set the correct Content-Type with boundary
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    // Only add Authorization header if we have one
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    const response = await fetch(`${STRAVA_API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    console.log('Strava API response:', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorMessage: string;
      let errorDetails: {
        message?: string;
        errors?: Array<{ resource: string; field: string; code: string }>;
        rawResponse?: string;
        parseError?: unknown;
      } = {};

      try {
        if (contentType?.includes('application/json')) {
          const error = (await response.json()) as StravaError;
          errorMessage = error.message ?? 'Unknown error';
          errorDetails = error;
        } else {
          errorMessage = await response.text();
          errorDetails = { rawResponse: errorMessage };
        }
      } catch (parseError) {
        console.error('Error parsing error response:', parseError);
        errorMessage = `Failed to parse error response: ${String(parseError)}`;
        errorDetails = { parseError };
      }

      // Log the full error response for debugging
      if (errorDetails.errors) {
        console.error('Strava API error details:', JSON.stringify(errorDetails.errors, null, 2));
      }
      
      console.error('Strava API error:', {
        message: errorMessage,
        status: response.status,
        statusText: response.statusText,
        contentType,
        details: errorDetails,
        endpoint,
        method: options.method ?? 'GET',
        bodyType: options.body instanceof FormData ? 'FormData' : typeof options.body,
        // If it's FormData, log the keys (but not values for security)
        formDataKeys: options.body instanceof FormData 
          ? Array.from(options.body.keys()) 
          : undefined,
      });

      // Token management is now handled outside this class
      // If we get a 401, we won't retry here as refreshing should be done before creating the client

      throw new StravaApiError(
        errorMessage,
        response.status,
        errorDetails.errors,
      );
    }

    try {
      return (await response.json()) as T;
    } catch (parseError) {
      console.error('Error parsing successful response:', {
        parseError,
        status: response.status,
        contentType: response.headers.get('content-type'),
      });
      throw new Error(
        `Failed to parse response as JSON: ${String(parseError)}`,
      );
    }
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

  async getActivityPhotos(id: number): Promise<StravaPhoto[]> {
    console.log(`[DEBUG] Fetching photos for activity ${id}`);

    try {
      const [smallPhotos, largePhotos] = await Promise.all([
        this.request<StravaPhoto[]>(
          `/activities/${id}/photos?size=256&photo_sources=true`,
        ),
        this.request<StravaPhoto[]>(
          `/activities/${id}/photos?size=5000&photo_sources=true`,
        ),
      ]);

      console.log(
        `[DEBUG] Raw photo data: small=${smallPhotos.length}, large=${largePhotos.length}`,
      );

      // Check for mismatches in photo counts
      if (smallPhotos.length !== largePhotos.length) {
        console.warn(
          `[DEBUG] Photo count mismatch: small=${smallPhotos.length}, large=${largePhotos.length}`,
        );
      }

      // Use the dedicated transform function to merge and process photos
      const mergedPhotos = mergeAndProcessStravaPhotos(
        smallPhotos,
        largePhotos,
      );

      console.log(
        `[DEBUG] Returning ${mergedPhotos.length} merged photos for activity ${id}`,
      );
      return mergedPhotos;
    } catch (error) {
      console.error(`[DEBUG] Error fetching photos for activity ${id}:`, error);
      throw error;
    }
  }

  async getSubscriptions(): Promise<StravaSubscription[]> {
    const searchParams = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const subscriptions = await this.request<StravaSubscription[]>(
      `/push_subscriptions?${searchParams}`,
    );
    
    console.log('Current Strava subscriptions:', JSON.stringify(subscriptions, null, 2));
    return subscriptions;
  }

  async createSubscription(
    callbackUrl: string,
    verifyToken: string,
  ): Promise<StravaSubscription> {
    // Create form data as per Strava API documentation
    const formData = new FormData();
    formData.append('client_id', this.clientId);
    formData.append('client_secret', this.clientSecret);
    formData.append('callback_url', callbackUrl);
    formData.append('verify_token', verifyToken);
    
    // Log the request details
    console.log('Creating Strava webhook subscription with:', {
      endpoint: '/push_subscriptions',
      client_id: this.clientId,
      callback_url: callbackUrl,
      verify_token: verifyToken,
      // Don't log the client secret
    });
    
    return this.request<StravaSubscription>('/push_subscriptions', {
      method: 'POST',
      body: formData,
      // Don't set Content-Type header, it will be set automatically with the boundary
    });
  }

  async deleteSubscription(id: number): Promise<void> {
    const searchParams = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    await this.request(`/push_subscriptions/${id}?${searchParams}`, {
      method: 'DELETE',
    });
  }
}
