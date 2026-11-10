'use server';

import { requireAdmin } from '~/server/auth/admin';
import { requireExternalEffectsEnabled } from '~/server/config/external-effects';
import { writerOf } from '~/server/repositories/writers';

import { moveLibraryToConvex, moveLibraryToPostgres } from './handoff-run';

/**
 * Operator controls for which store writes a library
 * (src/server/convex-mirror/handoff.ts). Each action calls `requireAdmin()`
 * itself and acts on the signed-in admin's own account only.
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
