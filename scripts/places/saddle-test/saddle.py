"""Circle saddle test for OSM passes on one global DEM (Copernicus GLO-30/90).

For each pass, sample circles of several radii around the OSM node and compare
with the DEM height at the node. On a real saddle the circle profile goes
above the node height on (at least) two separate arcs, the ridge flanks, and
below it on two separate arcs, the valleys. For each radius:
  rise = second-highest maximum among the above-node arcs
  drop = second-deepest minimum among the below-node arcs
  amp  = min(rise, drop)
The pass score is the radius with the largest amp. No prominence computation,
no tiles, no per-country sources.

usage: saddle.py <dem.vrt> <passes.csv> <out.csv>
"""

import csv
import math
import sys

import numpy as np
from osgeo import gdal

RADII = (200, 400, 800, 1500, 2500)
N = 72  # samples per circle (every 5 degrees)
ANGLES = np.linspace(0, 2 * math.pi, N, endpoint=False)


def arcs(sign: np.ndarray, values: np.ndarray) -> list[float]:
    """Extremes of each circular run where sign is True."""
    if sign.all():
        return [float(values.max())]
    if not sign.any():
        return []
    start = int(np.argmin(sign))  # rotate so the profile starts outside a run
    s, v = np.roll(sign, -start), np.roll(values, -start)
    out, cur = [], None
    for inside, x in zip(s, v):
        if inside:
            cur = x if cur is None else max(cur, x)
        elif cur is not None:
            out.append(float(cur))
            cur = None
    if cur is not None:
        out.append(float(cur))
    return out


def second(xs: list[float]) -> float:
    return sorted(xs, reverse=True)[1] if len(xs) >= 2 else 0.0


def main(dem_path: str, passes_path: str, out_path: str) -> None:
    gdal.UseExceptions()
    gdal.SetCacheMax(2 << 30)
    ds = gdal.Open(dem_path)
    band = ds.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    x0, px, _, y0, _, py = ds.GetGeoTransform()
    W, H = ds.RasterXSize, ds.RasterYSize
    rows = list(csv.DictReader(open(passes_path)))
    fields = ["id", "dem_z", "amp", "rise", "drop", "radius"]
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fields)
        w.writeheader()
        for i, r in enumerate(rows):
            lon, lat = float(r["lon"]), float(r["lat"])
            rmax = RADII[-1] + 200
            dlat = rmax / 110_540
            dlon = rmax / (111_320 * math.cos(math.radians(lat)))
            c0 = max(0, int((lon - dlon - x0) / px))
            c1 = min(W, int((lon + dlon - x0) / px) + 2)
            r0 = max(0, int((lat + dlat - y0) / py))
            r1 = min(H, int((lat - dlat - y0) / py) + 2)
            a = band.ReadAsArray(c0, r0, c1 - c0, r1 - r0).astype(np.float64)
            if nodata is not None:
                a[a == nodata] = np.nan

            def sample(lons, lats):
                cx = (lons - x0) / px - c0 - 0.5
                cy = (lats - y0) / py - r0 - 0.5
                ix = np.clip(np.floor(cx).astype(int), 0, a.shape[1] - 2)
                iy = np.clip(np.floor(cy).astype(int), 0, a.shape[0] - 2)
                fx, fy = cx - ix, cy - iy
                return (
                    a[iy, ix] * (1 - fx) * (1 - fy)
                    + a[iy, ix + 1] * fx * (1 - fy)
                    + a[iy + 1, ix] * (1 - fx) * fy
                    + a[iy + 1, ix + 1] * fx * fy
                )

            z0 = float(sample(np.array([lon]), np.array([lat]))[0])
            best = (0.0, 0.0, 0.0, 0)
            for rad in RADII:
                lats = lat + rad * np.cos(ANGLES) / 110_540
                lons = lon + rad * np.sin(ANGLES) / (111_320 * math.cos(math.radians(lat)))
                d = sample(lons, lats) - z0
                if np.isnan(d).any() or math.isnan(z0):
                    continue
                rise = second(arcs(d > 0, d))
                drop = second(arcs(d < 0, -d))
                amp = min(rise, drop)
                if amp > best[0]:
                    best = (amp, rise, drop, rad)
            w.writerow(
                {"id": r["id"], "dem_z": round(z0, 1), "amp": round(best[0], 1),
                 "rise": round(best[1], 1), "drop": round(best[2], 1), "radius": best[3]}
            )
            if i % 2000 == 0:
                print(i, file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:])
