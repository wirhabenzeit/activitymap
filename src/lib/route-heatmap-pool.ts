import type { ProjectedRoute } from '~/lib/route-heatmap';

type Tile = { z: number; x: number; y: number };
type Job = Tile & {
  id: number;
  resolve: (image: ImageBitmap | null) => void;
  signal?: AbortSignal;
};

/**
 * A small pool of heatmap tile workers. Requests queue on the main thread and
 * each worker draws one tile at a time, so tiles the map aborts (e.g. while
 * zooming through levels) are dropped before any work is spent on them.
 */
export class RouteHeatmapPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private running = new Map<Worker, Job | null>();
  private nextId = 0;

  constructor(size = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./route-heatmap.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.addEventListener('message', (event: MessageEvent<{ id: number; image: ImageBitmap | null }>) => {
        const job = this.running.get(worker);
        this.running.set(worker, null);
        if (job?.id === event.data.id) job.resolve(event.data.image);
        this.idle.push(worker);
        this.pump();
      });
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  setRoutes(routes: ProjectedRoute[]) {
    // Structured clone copies the typed arrays; the caller keeps its copy.
    for (const worker of this.workers) worker.postMessage({ type: 'routes', routes });
  }

  drawTile(tile: Tile, signal?: AbortSignal): Promise<ImageBitmap | null> {
    return new Promise((resolve) => {
      const job: Job = { ...tile, id: this.nextId++, resolve, signal };
      signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(job);
        if (index >= 0) this.queue.splice(index, 1);
        resolve(null);
      });
      this.queue.push(job);
      this.pump();
    });
  }

  terminate() {
    for (const worker of this.workers) worker.terminate();
    for (const job of this.queue) job.resolve(null);
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.running.clear();
  }

  private pump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      // Newest request first: it is most likely still on screen.
      const job = this.queue.pop()!;
      if (job.signal?.aborted) continue;
      const worker = this.idle.pop()!;
      this.running.set(worker, job);
      worker.postMessage({ type: 'tile', id: job.id, z: job.z, x: job.x, y: job.y });
    }
  }
}
