import { setWorkerUrl } from 'maplibre-gl';

// MapLibre 6 is ESM-only and no longer finds its worker inside a bundle.
// Next.js (Turbopack and webpack) emits the worker as a hashed asset for this
// exact `new URL(…, import.meta.url)` pattern. Fixture bundles built as IIFE
// have no `import.meta.url` and set their own worker before this runs.
if (typeof window !== 'undefined' && import.meta.url) {
  setWorkerUrl(
    new URL(
      'maplibre-gl/dist/maplibre-gl-worker.mjs',
      import.meta.url,
    ).toString(),
  );
}
