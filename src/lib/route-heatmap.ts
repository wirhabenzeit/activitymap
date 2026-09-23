/**
 * Client-side raster heatmap: routes are projected to Web Mercator once, then
 * each map tile is drawn on a canvas with one translucent stroke per route.
 * Overlapping passes accumulate opacity, so frequently travelled routes
 * saturate while single passes stay faint but sharp.
 */
export type HeatmapRoute = {
  color: string;
  coordinates: number[][]; // [lon, lat]
};

export type ProjectedRoute = {
  color: string;
  // Interleaved mercator x, y in [0, 1].
  points: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Tile size in CSS pixels; tiles are drawn at 2x for high-DPI screens. */
export const TILE_SIZE = 256;
const TILE_PIXELS = TILE_SIZE * 2;

const project = (lon: number, lat: number): [number, number] => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    lon / 360 + 0.5,
    0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  ];
};

export function projectRoutes(routes: HeatmapRoute[]): ProjectedRoute[] {
  return routes
    .filter((route) => route.coordinates.length > 1)
    .map(({ color, coordinates }) => {
      const points = new Float64Array(coordinates.length * 2);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      coordinates.forEach(([lon, lat], i) => {
        const [x, y] = project(lon!, lat!);
        points[i * 2] = x;
        points[i * 2 + 1] = y;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
      return { color, points, minX, minY, maxX, maxY };
    });
}

/**
 * Stroke width in tile pixels (2x). Zoomed out, lines stay ~1.75 CSS px so
 * single routes remain legible; zoomed in, the blur provides the body.
 */
const lineWidth = (z: number) => (z < 8 ? 3.5 : z < 10 ? 3 : z < 14 ? 2.5 : 3);

/** Blur radius in tile pixels: spreads passes into a density field. */
const blurRadius = (z: number) => (z < 10 ? 1 : z < 14 ? 2 : 3);

/** Each pass adds this much to the red count channel (so up to 63 passes). */
const PASS_VALUE = 4;
/** Passes at which the ramp reaches its hottest colour. */
const SATURATION_PASSES = 20;
/** Ramp resolution: [0, 1) covers the glow below one pass, [1, 2] the heat. */
const RAMP_STEPS = 512;

const parseHex = (hex: string) => {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Colour ramp per category over u in [0, 2]:
 * - u < 1 (fraction of a single pass, i.e. the soft edge of a line): the
 *   single-pass colour fading in, so edges stay smooth.
 * - u >= 1 (1 + log-scaled passes): the category colour for one pass, and a
 *   darker, opaque core for frequent routes.
 * A single pass is therefore always clearly visible, at every zoom level.
 */
const rampCache = new Map<string, Uint8ClampedArray>();
const rampFor = (color: string) => {
  let ramp = rampCache.get(color);
  if (ramp) return ramp;
  const [r, g, b] = parseHex(color);
  // [t, lighten (+) / darken (-), alpha] over the heat part t in [0, 1].
  const stops: [number, number, number][] = [
    [0, 0.05, 0.95],
    [0.35, 0, 0.92],
    [0.7, -0.3, 1],
    [1, -0.55, 1],
  ];
  const heat = (t: number) => {
    let k = 1;
    while (k < stops.length - 1 && stops[k]![0] < t) k++;
    const [t0, l0, a0] = stops[k - 1]!;
    const [t1, l1, a1] = stops[k]!;
    const f = (t - t0) / (t1 - t0);
    return [mix(l0, l1, f), mix(a0, a1, f)] as const;
  };
  ramp = new Uint8ClampedArray(RAMP_STEPS * 4);
  for (let i = 0; i < RAMP_STEPS; i++) {
    const u = (2 * i) / (RAMP_STEPS - 1);
    const [light, alpha] = u < 1 ? [heat(0)[0], heat(0)[1] * u ** 0.7] : heat(u - 1);
    const channel = (c: number) => (light >= 0 ? mix(c, 255, light) : c * (1 + light));
    ramp[i * 4] = channel(r);
    ramp[i * 4 + 1] = channel(g);
    ramp[i * 4 + 2] = channel(b);
    ramp[i * 4 + 3] = 255 * alpha;
  }
  rampCache.set(color, ramp);
  return ramp;
};

/**
 * Peak density of a single isolated pass after blurring, used to normalise
 * density so one pass maps to 1 regardless of line width and blur radius.
 */
const peakCache = new Map<string, number>();
const singlePassPeak = (width: number, radius: number) => {
  const key = `${width}/${radius}`;
  let peak = peakCache.get(key);
  if (peak !== undefined) return peak;
  const size = 64;
  const profile = new Float32Array(size);
  const centre = size / 2;
  for (let i = 0; i < size; i++) {
    // Pixel coverage of a line of `width` centred between pixels.
    const lo = Math.max(i, centre - width / 2);
    const hi = Math.min(i + 1, centre + width / 2);
    profile[i] = Math.max(0, hi - lo);
  }
  for (let n = 0; n < 2; n++) {
    const copy = profile.slice();
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += copy[Math.min(size - 1, Math.max(0, i + k))]!;
      profile[i] = sum / (2 * radius + 1);
    }
  }
  peak = Math.max(...profile);
  peakCache.set(key, peak);
  return peak;
};

/** In-place separable box blur, run twice to approximate a gaussian. */
const blur = (src: Float32Array, size: number, radius: number) => {
  const tmp = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const norm = 1 / (2 * radius + 1);
    for (let line = 0; line < size; line++) {
      let sum = 0;
      const at = (i: number) => {
        const c = Math.min(size - 1, Math.max(0, i));
        return horizontal ? from[line * size + c]! : from[c * size + line]!;
      };
      for (let i = -radius; i <= radius; i++) sum += at(i);
      for (let i = 0; i < size; i++) {
        to[horizontal ? line * size + i : i * size + line] = sum * norm;
        sum += at(i + radius + 1) - at(i - radius);
      }
    }
  };
  for (let n = 0; n < 2; n++) {
    pass(src, tmp, true);
    pass(tmp, src, false);
  }
};

export function drawTile(
  routes: ProjectedRoute[],
  tile: { z: number; x: number; y: number },
): ImageBitmap | null {
  const scale = 2 ** tile.z;
  const width = lineWidth(tile.z);
  const radius = blurRadius(tile.z);
  // Include routes just outside the tile so the blur has no seams.
  const margin = (width + 4 * radius) / (TILE_PIXELS * scale);
  const minX = tile.x / scale - margin;
  const minY = tile.y / scale - margin;
  const maxX = (tile.x + 1) / scale + margin;
  const maxY = (tile.y + 1) / scale + margin;

  // Routes arrive sorted by category frequency; keep that drawing order.
  const byColor = new Map<string, ProjectedRoute[]>();
  for (const r of routes) {
    if (r.maxX < minX || r.minX > maxX || r.maxY < minY || r.minY > maxY) continue;
    const list = byColor.get(r.color);
    if (list) list.push(r);
    else byColor.set(r.color, [r]);
  }
  if (byColor.size === 0) return null;

  // Count canvas has a border so the blur sees routes beyond the tile edge.
  const border = 4 * radius;
  const size = TILE_PIXELS + 2 * border;
  const counts = new OffscreenCanvas(size, size);
  const countCtx = counts.getContext('2d', { willReadFrequently: true });
  const output = new OffscreenCanvas(TILE_PIXELS, TILE_PIXELS);
  const outputCtx = output.getContext('2d');
  const layer = new OffscreenCanvas(TILE_PIXELS, TILE_PIXELS);
  const layerCtx = layer.getContext('2d');
  if (!countCtx || !outputCtx || !layerCtx) return null;

  const toPx = TILE_PIXELS * scale;
  const offsetX = tile.x * TILE_PIXELS - border;
  const offsetY = tile.y * TILE_PIXELS - border;
  const density = new Float32Array(size * size);
  const logSaturation = Math.log(SATURATION_PASSES);
  const onePass = singlePassPeak(width, radius);

  for (const [color, list] of byColor) {
    // Pass 1: accumulate how many routes cover each pixel.
    countCtx.globalCompositeOperation = 'copy';
    countCtx.fillStyle = 'rgba(0,0,0,0)';
    countCtx.fillRect(0, 0, size, size);
    countCtx.globalCompositeOperation = 'lighter';
    countCtx.strokeStyle = `rgb(${PASS_VALUE},0,0)`;
    countCtx.lineWidth = width;
    countCtx.lineJoin = 'round';
    countCtx.lineCap = 'round';
    for (const { points } of list) {
      countCtx.beginPath();
      let lastX = points[0]! * toPx - offsetX;
      let lastY = points[1]! * toPx - offsetY;
      countCtx.moveTo(lastX, lastY);
      for (let i = 2; i < points.length; i += 2) {
        const px = points[i]! * toPx - offsetX;
        const py = points[i + 1]! * toPx - offsetY;
        // Skip sub-pixel steps: at low zooms most vertices collapse.
        if (Math.abs(px - lastX) < 0.75 && Math.abs(py - lastY) < 0.75) continue;
        countCtx.lineTo(px, py);
        lastX = px;
        lastY = py;
      }
      // One stroke per route: a route never counts itself twice.
      countCtx.stroke();
    }

    // Pass 2: counts -> blurred density (in passes).
    const raw = countCtx.getImageData(0, 0, size, size).data;
    for (let i = 0, p = 0; p < density.length; i += 4, p++) {
      // 'lighter' stores premultiplied values: red * alpha recovers the sum.
      density[p] = (raw[i]! * raw[i + 3]!) / 255 / PASS_VALUE;
    }
    blur(density, size, radius);

    // Pass 3: density -> heat ramp, cropped to the tile.
    const image = layerCtx.createImageData(TILE_PIXELS, TILE_PIXELS);
    const out = image.data;
    const ramp = rampFor(color);
    for (let y = 0; y < TILE_PIXELS; y++) {
      for (let x = 0; x < TILE_PIXELS; x++) {
        const passes = density[(y + border) * size + x + border]! / onePass;
        if (passes < 0.03) continue;
        const u = passes < 1 ? passes : 1 + Math.min(1, Math.log(passes) / logSaturation);
        const o = Math.round((u / 2) * (RAMP_STEPS - 1)) * 4;
        const q = (y * TILE_PIXELS + x) * 4;
        out[q] = ramp[o]!;
        out[q + 1] = ramp[o + 1]!;
        out[q + 2] = ramp[o + 2]!;
        out[q + 3] = ramp[o + 3]!;
      }
    }
    layerCtx.putImageData(image, 0, 0);
    outputCtx.drawImage(layer, 0, 0);
  }

  return output.transferToImageBitmap();
}
