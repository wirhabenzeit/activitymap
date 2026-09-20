import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

/**
 * Capability token generation/hashing for private share links (issue #132).
 * Deliberately mirrors `~/server/auth/mobile.ts`'s
 * `generateMobileLoginCode`/`hashMobileLoginCode`: a high-entropy random
 * value, base64url-encoded, hashed with SHA-256 (also base64url) before it
 * ever touches storage. `~/server/repositories/share-links.ts` stores only
 * the hash - see `shareLinks.tokenHash` in `~/server/db/schema.ts` - so a
 * database read, backup, or log line can never reconstruct a usable token.
 */

/** 32 random bytes (256 bits) - comfortably unguessable, matching the mobile login code's entropy. */
export const SHARE_TOKEN_BYTES = 32;

/** Generates the plaintext capability token returned to the creator exactly once. */
export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

/** Hashes a plaintext token for storage/lookup - the database never holds the plaintext. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}
