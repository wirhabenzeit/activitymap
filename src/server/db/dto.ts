import type { Account, User } from './schema';

/**
 * The only user/account shape that may cross the server/client boundary.
 * Never add token, secret, or provider-account-ID fields here — see issue #116.
 */
export type CurrentUserDTO = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  athleteId: number | null;
  stravaConnected: boolean;
};

export function toCurrentUserDTO(
  user: User,
  account: Account | null,
): CurrentUserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    athleteId: user.athlete_id ?? null,
    stravaConnected: Boolean(account?.access_token ?? account?.accessToken),
  };
}
