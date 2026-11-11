'use server';

import { requireAdmin } from '~/server/auth/admin';
import { copySignInRecordsToConvex } from '~/server/auth/copy-to-convex';
import { authStoreIsConvex } from '~/server/auth/store';
import { requireExternalEffectsEnabled } from '~/server/config/external-effects';
import { writerOf } from '~/server/repositories/writers';

import {
  libraryMoveStatus,
  moveReadyLibraries,
  prepareAllLibraries,
} from './accounts';
import { moveLibraryToConvex, moveLibraryToPostgres } from './handoff-run';

/**
 * Operator controls for which store writes a library
 * (src/server/convex-mirror/handoff.ts and accounts.ts). Each action calls
 * `requireAdmin()` itself. The first three act on the signed-in admin's own
 * account; the rest on every connected account.
 */

/** Which store writes the admin's own library. */
export async function myLibraryWriter() {
  const admin = await requireAdmin();
  return writerOf(admin.id);
}

/** Make Convex the writer of the admin's own library. */
export async function moveMyLibraryToConvex() {
  const admin = await requireAdmin();
  requireExternalEffectsEnabled();
  return moveLibraryToConvex(admin.id);
}

/** Make Postgres the writer of the admin's own library again. */
export async function moveMyLibraryToPostgres() {
  const admin = await requireAdmin();
  requireExternalEffectsEnabled();
  return moveLibraryToPostgres(admin.id);
}

/** Every connected account: who writes it, and how far its copy is. */
export async function allLibraryStatus() {
  await requireAdmin();
  return libraryMoveStatus();
}

/** Give every account Postgres still writes a library in Convex and start
 * copying it. Changes nothing the accounts can see. */
export async function prepareAllLibrariesForConvex() {
  await requireAdmin();
  requireExternalEffectsEnabled();
  return prepareAllLibraries();
}

/** Move every prepared account whose copy has finished to Convex. */
export async function moveReadyLibrariesToConvex() {
  await requireAdmin();
  requireExternalEffectsEnabled();
  return moveReadyLibraries();
}

/**
 * Copy users, linked accounts with their tokens and the signing keys from
 * Postgres into the sign-in store in Convex. The last step before the app
 * is switched to that store; refused once it has been.
 */
export async function copySignInRecords() {
  await requireAdmin();
  requireExternalEffectsEnabled();
  if (authStoreIsConvex())
    throw new Error('Sign-in records already live in Convex');
  return copySignInRecordsToConvex();
}
