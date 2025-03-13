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
  constructor(
    private accessToken: string
  ) {
    console.log('StravaClient initialized:', { 
      hasToken: !!accessToken,
      tokenLength: accessToken ? accessToken.length : 0
    });
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0,
  ): Promise<T> {
    console.log('Making Strava API request:', {
      endpoint,
      method: options.method ?? 'GET',
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

      console.error('Strava API error:', {
        message: errorMessage,
        status: response.status,
        contentType,
        details: errorDetails,
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
      throw new Error(`Failed to parse response as JSON: ${String(parseError)}`);
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

      console.log(`[DEBUG] Raw photo data: small=${smallPhotos.length}, large=${largePhotos.length}`);
      
      // Log some info about each photo set
      if (smallPhotos.length > 0) {
        const smallSample = smallPhotos[0]!;
        console.log(`[DEBUG] Small photo sample:`, {
          id: smallSample.unique_id,
          source: smallSample.source,
          hasUrls: !!smallSample.urls,
          hasSizes: !!smallSample.sizes,
          urlKeys: smallSample.urls ? Object.keys(smallSample.urls) : [],
          sizeKeys: smallSample.sizes ? Object.keys(smallSample.sizes) : []
        });
      }
      
      if (largePhotos.length > 0) {
        const largeSample = largePhotos[0]!;
        console.log(`[DEBUG] Large photo sample:`, {
          id: largeSample.unique_id,
          source: largeSample.source,
          hasUrls: !!largeSample.urls,
          hasSizes: !!largeSample.sizes,
          urlKeys: largeSample.urls ? Object.keys(largeSample.urls) : [],
          sizeKeys: largeSample.sizes ? Object.keys(largeSample.sizes) : []
        });
      }

      // Check for mismatches in photo counts
      if (smallPhotos.length !== largePhotos.length) {
        console.warn(`[DEBUG] Photo count mismatch: small=${smallPhotos.length}, large=${largePhotos.length}`);
        
        // Log all photo IDs to help identify mismatches
        console.log('[DEBUG] Small photo IDs:', smallPhotos.map(p => p.unique_id));
        console.log('[DEBUG] Large photo IDs:', largePhotos.map(p => p.unique_id));
      }
      
      // Create a map of small photos by ID for easier lookup
      const smallPhotoMap = new Map<string, StravaPhoto>();
      smallPhotos.forEach(photo => {
        smallPhotoMap.set(photo.unique_id, photo);
      });
      
      // Create a map of large photos by ID for easier lookup
      const largePhotoMap = new Map<string, StravaPhoto>();
      largePhotos.forEach(photo => {
        largePhotoMap.set(photo.unique_id, photo);
      });
      
      // Get the complete set of unique photo IDs
      const allPhotoIds = new Set<string>([
        ...smallPhotos.map(p => p.unique_id),
        ...largePhotos.map(p => p.unique_id)
      ]);
      
      // Merge photos based on ID rather than index
      const mergedPhotos: StravaPhoto[] = [];
      
      for (const photoId of allPhotoIds) {
        const smallPhoto = smallPhotoMap.get(photoId);
        const largePhoto = largePhotoMap.get(photoId);
        
        if (!smallPhoto && !largePhoto) {
          console.warn(`[DEBUG] Photo ID ${photoId} not found in either small or large photos - this should never happen`);
          continue;
        }
        
        // Use large photo as base if available, otherwise use small
        const basePhoto = largePhoto ?? smallPhoto!;
        
        // Special case: Check if the photo is a special size (like 1800)
        const specialSize = basePhoto.urls && 
                            basePhoto.urls["256"] === undefined && 
                            basePhoto.urls["5000"] === undefined;
                            
        if (specialSize) {
          console.log(`[DEBUG] Photo ${photoId} has special size:`, {
            urlKeys: basePhoto.urls ? Object.keys(basePhoto.urls) : [],
            sizeKeys: basePhoto.sizes ? Object.keys(basePhoto.sizes) : []
          });
          
          // For special size photos, check if this appears to be a placeholder
          // Primary detection: Look for "placeholder" in the URL
          let isPlaceholder = false;
          
          if (basePhoto.urls) {
            // Check all URLs for the word "placeholder"
            for (const url of Object.values(basePhoto.urls)) {
              if (url.includes('placeholder')) {
                isPlaceholder = true;
                console.log(`[DEBUG] Photo ${photoId} appears to be a placeholder by URL check`);
                break;
              }
            }
          }
          
          // Fallback detection: Check for special size pattern
          const urlKeys = basePhoto.urls ? Object.keys(basePhoto.urls) : [];
          if (!isPlaceholder && urlKeys.length === 1 && urlKeys[0] === "1800") {
            isPlaceholder = true;
            console.log(`[DEBUG] Photo ${photoId} appears to be a placeholder by size pattern`);
          }
          
          if (isPlaceholder) {
            // Skip placeholder images - don't include them in the results
            console.log(`[PLACEHOLDER] Photo ${photoId} is being filtered out as a placeholder image`);
            continue;
          }
        }
        
        // Normal case: Merge small and large photo data
        const merged = {
          ...basePhoto,
          urls: { 
            ...(smallPhoto?.urls ?? {}), 
            ...(largePhoto?.urls ?? {}) 
          },
          sizes: { 
            ...(smallPhoto?.sizes ?? {}), 
            ...(largePhoto?.sizes ?? {}) 
          },
        };
        
        if (mergedPhotos.length === 0) {
          console.log(`[DEBUG] Merged photo sample:`, {
            id: merged.unique_id,
            hasUrls: !!merged.urls,
            hasSizes: !!merged.sizes,
            urlKeys: merged.urls ? Object.keys(merged.urls) : [],
            sizeKeys: merged.sizes ? Object.keys(merged.sizes) : []
          });
        }
        
        mergedPhotos.push(merged);
      }

      console.log(`[DEBUG] Returning ${mergedPhotos.length} merged photos for activity ${id}`);
      return mergedPhotos;
    } catch (error) {
      console.error(`[DEBUG] Error fetching photos for activity ${id}:`, error);
      throw error;
    }
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
