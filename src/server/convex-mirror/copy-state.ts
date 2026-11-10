import type { MirrorPosition } from './mirror';

/** Where an account's copy into Convex stands, from the Convex owner. */
export type CopyState =
  /** The account has no library in Convex. */
  | 'none'
  /** Provisioned, and the mirror is still copying the library. */
  | 'copying'
  /** Copied; the mirror keeps it current until the account moves. */
  | 'ready';

export function copyState(
  owner: { revoked: boolean; mirror: MirrorPosition | null } | null,
): CopyState {
  if (!owner || owner.revoked) return 'none';
  const { mirror } = owner;
  // A position without an unfinished full copy or photo catch-up.
  return mirror && !mirror.full && typeof mirror.photos !== 'string'
    ? 'ready'
    : 'copying';
}
