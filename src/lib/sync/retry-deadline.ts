/** Preserve server Retry-After even when the browser clock runs ahead. */
export function retryDeadline(headers: Headers, now = Date.now()): number {
  const raw = headers.get('retry-after')?.trim();
  const serverDate = Date.parse(headers.get('date') ?? '');
  const reference = Number.isFinite(serverDate)
    ? Math.min(now, serverDate)
    : now;
  const delay =
    raw && /^\d+$/.test(raw)
      ? Number(raw) * 1000
      : raw
        ? Date.parse(raw) - reference
        : 60_000;
  return now + Math.max(60_000, Number.isFinite(delay) ? delay : 60_000);
}
