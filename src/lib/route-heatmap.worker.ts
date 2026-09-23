import { drawTile, type ProjectedRoute } from '~/lib/route-heatmap';

/**
 * Draws heatmap tiles off the main thread so map interaction stays smooth.
 * Messages: `routes` replaces the data; `tile` draws one tile and replies
 * with a transferable ImageBitmap (or null for an empty tile).
 */
type Request =
  | { type: 'routes'; routes: ProjectedRoute[] }
  | { type: 'tile'; id: number; z: number; x: number; y: number };

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<Request>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let routes: ProjectedRoute[] = [];

scope.addEventListener('message', ({ data }) => {
  if (data.type === 'routes') {
    routes = data.routes;
    return;
  }
  const image = drawTile(routes, data);
  scope.postMessage({ id: data.id, image }, image ? [image] : []);
});
