export type ActivityImportCursor = {
  before: number;
  page: number;
  done: boolean;
};
export type ActivityImportProgress = {
  summaries: number;
  details: number;
  photos: number;
  requests: number;
  cursor: ActivityImportCursor | null;
};
export const ACTIVITY_IMPORT_COOLDOWN_MS = 5 * 60_000;
export const ACTIVITY_IMPORT_LEASE_MS = 90_000;
