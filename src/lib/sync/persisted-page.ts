/**
 * Persist a fetched page inside the shared query function, not in each
 * observer's effect. Await the write so pagination cannot queue unbounded
 * IndexedDB transactions. A cache failure must not hide fresh server data.
 */
export async function fetchAndPersistPage<T>({
  fetchPage,
  persistPage,
  onPersistenceError,
}: {
  fetchPage: () => Promise<T[]>;
  persistPage: (page: T[]) => Promise<void>;
  onPersistenceError: (error: unknown) => void;
}): Promise<T[]> {
  const page = await fetchPage();
  if (page.length > 0) {
    try {
      await persistPage(page);
    } catch (error) {
      onPersistenceError(error);
    }
  }
  return page;
}
