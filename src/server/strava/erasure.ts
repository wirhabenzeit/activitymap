export const DEFAULT_ERASURE_BATCH_SIZE = 25;
export const MAX_ERASURE_BATCH_SIZE = 100;

export type ErasureRunResult = {
  candidates: number;
  erased: number;
  cancelled: number;
  stale: number;
  failed: number;
};
