export type RequestSessionResolver<T> = (input: {
  headers: Headers;
}) => Promise<T>;

/**
 * Resolve an application session from HTTP headers only.
 *
 * Keeping the request URL out of the resolver input makes query-string
 * credentials impossible to reintroduce accidentally at protected routes.
 */
export function resolveRequestSession<T>(
  request: Pick<Request, 'headers'>,
  resolveSession: RequestSessionResolver<T>,
): Promise<T> {
  return resolveSession({ headers: request.headers });
}
