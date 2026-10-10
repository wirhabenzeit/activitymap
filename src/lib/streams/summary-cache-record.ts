import type {
  ActivityCompactStreamSummaryDTO,
  StreamMetadata,
} from '~/contracts/v1/activity-streams';

/** Only the compact wire payload is persisted; decoded chart arrays stay in views. */
export type CachedStreamSummary = {
  data: ActivityCompactStreamSummaryDTO;
  requestedAgainst: StreamMetadata | null;
};

export const sameStreamMetadata = (
  left: StreamMetadata | null | undefined,
  right: StreamMetadata | null | undefined,
) =>
  (left?.generation ?? null) === (right?.generation ?? null) &&
  (left?.revision ?? '0') === (right?.revision ?? '0') &&
  (left?.state ?? 'not_fetched') === (right?.state ?? 'not_fetched');

export function canReuseCachedStreamSummary(
  record: CachedStreamSummary | undefined,
  observed: StreamMetadata | undefined,
): boolean {
  if (!record?.data.summary || record.data.metadata.state !== 'current')
    return false;
  if (!observed) return true;
  const metadata = record.data.metadata;
  return (
    sameStreamMetadata(observed, metadata) ||
    sameStreamMetadata(observed, record.requestedAgainst) ||
    (observed.state === 'current' &&
      observed.generation !== null &&
      observed.generation === metadata.generation &&
      BigInt(metadata.revision) >= BigInt(observed.revision))
  );
}
