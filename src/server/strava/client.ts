import { z } from 'zod';
import type { StravaRequestBudget } from './request-budget';
import type {
  StravaActivity,
  StravaPhoto,
  StravaSubscription,
  StravaError,
  UpdatableActivity,
} from './types';
import { mergeAndProcessStravaPhotos } from './transforms';
import { logger } from '~/server/logging/logger';
import { requireStravaAccessEnabled } from '~/server/config/external-effects';
import {
  ACTIVITY_STREAM_TYPES,
  rawActivityStreamsSchema,
  streamActivityIdSchema,
  type RawActivityStreams,
} from './streams';

const STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3';
const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';

const stravaTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int().positive(),
  expires_in: z.number().int().nonnegative(),
});

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
}

export interface StravaRateLimitWindow {
  limit15Minutes: number;
  limitDaily: number;
  usage15Minutes: number;
  usageDaily: number;
}

export interface StravaRateLimitUsage {
  overall?: StravaRateLimitWindow;
  read?: StravaRateLimitWindow;
}

function parseRateLimitPair(value: string | null): [number, number] | null {
  if (!value) return null;
  const values = value.split(',').map((part) => Number(part.trim()));
  if (
    values.length !== 2 ||
    values.some((item) => !Number.isInteger(item) || item < 0)
  ) {
    return null;
  }
  return [values[0]!, values[1]!];
}

function parseRateLimitWindow(
  limit: string | null,
  usage: string | null,
): StravaRateLimitWindow | null {
  const parsedLimit = parseRateLimitPair(limit);
  const parsedUsage = parseRateLimitPair(usage);
  if (!parsedLimit || !parsedUsage) return null;
  return {
    limit15Minutes: parsedLimit[0],
    limitDaily: parsedLimit[1],
    usage15Minutes: parsedUsage[0],
    usageDaily: parsedUsage[1],
  };
}

export function parseStravaRateLimitUsage(
  headers: Pick<Headers, 'get'>,
): StravaRateLimitUsage | null {
  const overall = parseRateLimitWindow(
    headers.get('x-ratelimit-limit'),
    headers.get('x-ratelimit-usage'),
  );
  const read = parseRateLimitWindow(
    headers.get('x-readratelimit-limit'),
    headers.get('x-readratelimit-usage'),
  );
  if (!overall && !read) return null;
  return {
    ...(overall ? { overall } : {}),
    ...(read ? { read } : {}),
  };
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

/**
 * Strava also uses 404 for responses that do not prove an activity was
 * deleted (for example, a private activity without activity:read_all).
 * The client normalizes Strava's JSON `message` directly into `Error.message`.
 * Only the exact recognized missing-record message is safe to turn into a
 * local tombstone.
 */
export function isStravaActivityNotFoundError(
  error: unknown,
): boolean {
  return (
    error instanceof StravaApiError &&
    error.status === 404 &&
    error.message.trim().toLowerCase() === 'record not found'
  );
}

type StravaClientOptions = {
  onRateLimit?: (usage: StravaRateLimitUsage) => void;
  requestBudget?: StravaRequestBudget;
  signal?: AbortSignal;
  beforeRequest?: () => Promise<void>;
};

export class StravaClient {
  private accessToken?: string;
  private requestBudget?: StravaRequestBudget;
  private signal?: AbortSignal;
  private beforeRequest?: () => Promise<void>;
  private refreshToken?: string;
  private clientId: string;
  private clientSecret: string;
  private tokenRefreshCallback?: (tokens: StravaTokens) => Promise<void>;
  private rateLimitCallback?: (usage: StravaRateLimitUsage) => void;

  private constructor({
    accessToken,
    refreshToken,
    tokenRefreshCallback,
    rateLimitCallback,
    requestBudget,
    signal,
    beforeRequest,
  }: {
    accessToken?: string;
    refreshToken?: string;
    tokenRefreshCallback?: (tokens: StravaTokens) => Promise<void>;
    rateLimitCallback?: (usage: StravaRateLimitUsage) => void;
    requestBudget?: StravaRequestBudget;
    signal?: AbortSignal;
    beforeRequest?: () => Promise<void>;
  }) {
    requireStravaAccessEnabled();

    this.requestBudget = requestBudget;
    this.signal = signal;
    this.beforeRequest = beforeRequest;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenRefreshCallback = tokenRefreshCallback;
    this.rateLimitCallback = rateLimitCallback;

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
  }

  /**
   * Create a StravaClient with an access token for authenticated user operations
   */
  static withAccessToken(
    accessToken: string,
    {
      onRateLimit, requestBudget, signal, beforeRequest,
    }: StravaClientOptions = {},
  ): StravaClient {
    return new StravaClient({ accessToken, rateLimitCallback: onRateLimit, requestBudget, signal, beforeRequest });
  }

  /**
   * Create a StravaClient with a refresh token that can refresh access tokens
   */
  static withRefreshToken(
    refreshToken: string,
    tokenRefreshCallback: (tokens: StravaTokens) => Promise<void>,
    { onRateLimit, requestBudget, signal, beforeRequest }: StravaClientOptions = {},
  ): StravaClient {
    return new StravaClient({ refreshToken, tokenRefreshCallback, rateLimitCallback: onRateLimit, requestBudget, signal, beforeRequest });
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

  private async budgetedFetch(url: string, init: RequestInit): Promise<Response> {
    const budget = this.requestBudget ??
      (await import('~/server/repositories/strava-budget')).stravaRequestBudget;
    // All currently supported operations are non-upload endpoints, including
    // activity edits. Conservatively charge OAuth against both limits too.
    const ticket = await budget.reserve(true);
    let response: Response;
    try {
      await this.beforeRequest?.();
      response = await fetch(url, { ...init, signal: this.signal ?? init.signal });
    } catch (error) {
      // Keep the reservation charged, but no longer count it as in flight.
      await budget.observe(ticket, null, 0);
      throw error;
    }
    await budget.observe(ticket, parseStravaRateLimitUsage(response.headers), response.status);
    return response;
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<StravaTokens> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await this.budgetedFetch(STRAVA_TOKEN_URL, {
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

      const usage = parseStravaRateLimitUsage(response.headers);
      if (usage) this.rateLimitCallback?.(usage);
      if (!response.ok) {
        throw new StravaApiError('Failed to refresh access token', response.status);
      }
      const tokens = stravaTokensSchema.parse(await response.json());

      // Persist/authorize first. A rejected callback must not leave this client
      // holding credentials that could be reused after account revocation.
      await this.tokenRefreshCallback?.(tokens);
      this.accessToken = tokens.access_token;
      this.refreshToken = tokens.refresh_token;
      return tokens;
    } catch (error) {
      logger.error('Error refreshing access token:', error);
      throw error;
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
    _retryCount = 0,
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

    const response = await this.budgetedFetch(`${STRAVA_API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });
    const rateLimitUsage = parseStravaRateLimitUsage(response.headers);
    if (rateLimitUsage) this.rateLimitCallback?.(rateLimitUsage);

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
        logger.error('Error parsing error response:', parseError);
        errorMessage = `Failed to parse error response: ${String(parseError)}`;
        errorDetails = { parseError };
      }

      // Log the full error response for debugging
      if (errorDetails.errors) {
        logger.error(
          'Strava API error details:',
          JSON.stringify(errorDetails.errors, null, 2),
        );
      }

      logger.error('Strava API error:', {
        message: errorMessage,
        status: response.status,
        statusText: response.statusText,
        contentType,
        details: errorDetails,
        endpoint,
        method: options.method ?? 'GET',
        bodyType:
          options.body instanceof FormData ? 'FormData' : typeof options.body,
        // If it's FormData, log the keys (but not values for security)
        formDataKeys:
          options.body instanceof FormData
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
      logger.error('Error parsing successful response:', {
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

  async getActivityStreams(id: string): Promise<RawActivityStreams> {
    const activityId = streamActivityIdSchema.parse(id);
    const query = new URLSearchParams({
      keys: ACTIVITY_STREAM_TYPES.join(','), key_by_type: 'true',
    });
    return rawActivityStreamsSchema.parse(
      await this.request<unknown>(`/activities/${activityId}/streams?${query}`),
    );
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
    try {
      const [smallPhotos, largePhotos] = await Promise.all([
        this.request<StravaPhoto[]>(
          `/activities/${id}/photos?size=256&photo_sources=true`,
        ),
        this.request<StravaPhoto[]>(
          `/activities/${id}/photos?size=5000&photo_sources=true`,
        ),
      ]);

      // Check for mismatches in photo counts
      if (smallPhotos.length !== largePhotos.length) {
        logger.warn(
          `[DEBUG] Photo count mismatch: small=${smallPhotos.length}, large=${largePhotos.length}`,
        );
      }

      // Use the dedicated transform function to merge and process photos
      const mergedPhotos = mergeAndProcessStravaPhotos(
        smallPhotos,
        largePhotos,
      );

      return mergedPhotos;
    } catch (error) {
      logger.error(`[DEBUG] Error fetching photos for activity ${id}:`, error);
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
