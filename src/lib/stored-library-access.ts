/** Reading an attached lab library does not grant provider refresh/edit access. */
export function hasStoredLibraryAccess(
  user:
    | { stravaConnected: boolean; storedLibraryPreview?: boolean }
    | null
    | undefined,
) {
  return user?.stravaConnected === true || user?.storedLibraryPreview === true;
}
