/** Sync handlers serve private JSON through the same encoding negotiation on
 * hosted and standalone Next, including clients that request identity. */
export async function compressSyncResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (
    request.method !== 'GET' ||
    !response.ok ||
    !response.body ||
    response.headers.has('content-encoding') ||
    !response.headers.get('content-type')?.startsWith('application/json') ||
    response.headers.get('cache-control')?.includes('no-transform')
  )
    return response;

  const headers = new Headers(response.headers);
  if (
    !headers
      .get('vary')
      ?.split(',')
      .some((name) =>
        ['*', 'accept-encoding'].includes(name.trim().toLowerCase()),
      )
  )
    headers.append('vary', 'Accept-Encoding');

  const encodings = new Map(
    (request.headers.get('accept-encoding') ?? '').split(',').map((entry) => {
      const [name, ...parameters] = entry.trim().toLowerCase().split(';');
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith('q='));
      return [name, quality === undefined ? 1 : Number(quality.slice(2))];
    }),
  );
  const quality = encodings.get('gzip') ?? encodings.get('*') ?? 0;
  let body = response.body;
  if (quality > 0 && quality <= 1) {
    headers.set('content-encoding', 'gzip');
    headers.delete('content-length');
    headers.delete('etag');
    body = body.pipeThrough(new CompressionStream('gzip'));
  }
  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
