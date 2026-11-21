import { z } from 'zod';

const stravaProfileSchema = z.object({
  id: z.union([z.string(), z.number()]),
  email: z.string().email().nullish(),
  firstname: z.string().nullish(),
  lastname: z.string().nullish(),
  profile: z.string().nullish(),
});

export type StravaUserInfo = {
  id: string;
  email: string;
  name: string;
  image: string | undefined;
  emailVerified: false;
};

/**
 * Reads the signed-in athlete and maps it onto a Better Auth user. Strava is
 * not OIDC, so both the web sign-in (`~/lib/auth.ts`) and the iOS app sign-in
 * (`./strava-app-sign-in.ts`) fetch the profile this way.
 *
 * Strava does not release an email address in general, so the placeholder
 * `@strava.local` one is never treated as verified.
 */
export async function fetchStravaUserInfo(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StravaUserInfo | null> {
  const response = await fetchImpl('https://www.strava.com/api/v3/athlete', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;

  const rawProfile: unknown = await response.json();
  const parsedProfile = stravaProfileSchema.safeParse(rawProfile);
  if (!parsedProfile.success) return null;

  const profile = parsedProfile.data;
  const athleteId = profile.id.toString();
  const fullName =
    `${profile.firstname ?? ''} ${profile.lastname ?? ''}`.trim();

  return {
    id: athleteId,
    email: profile.email ?? `${athleteId}@strava.local`,
    name: fullName || `Strava ${athleteId}`,
    image: profile.profile ?? undefined,
    emailVerified: false,
  };
}
