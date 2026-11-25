"""Local peak prominence from one global DEM (Copernicus GLO-90/30).

For each OSM peak, start at the highest DEM cell within SNAP_M of the node and
flood downhill in a window of WINDOW_M, always taking the highest unvisited
neighbour (a priority flood). The lowest level passed before reaching higher
ground is the key col, so prominence = summit - col, exact within the DEM.
If the flood reaches the window edge first, prominence is at least
summit - edge height and the row is marked capped: this happens only for
peaks that dominate their whole window, which no filter would hide.
No tiles, no global prominence run.

usage: peaks.py <dem.vrt> <peaks.csv> <out.csv>
"""

import csv
import heapq
import math
import sys
from multiprocessing import Pool

import numpy as np
from osgeo import gdal

SNAP_M = 250
WINDOW_M = 3000
DEM = None


def init(path: str) -> None:
    global DEM
    gdal.UseExceptions()
    gdal.SetCacheMax(512 << 20)
    DEM = gdal.Open(path)


def prominence(row: dict) -> dict:
    band = DEM.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    x0, px, _, y0, _, py = DEM.GetGeoTransform()
    lon, lat = float(row["lon"]), float(row["lat"])
    mx, my = 111_320 * math.cos(math.radians(lat)), 110_540
    c0 = max(0, int((lon - WINDOW_M / mx - x0) / px))
    c1 = min(DEM.RasterXSize, int((lon + WINDOW_M / mx - x0) / px) + 2)
    r0 = max(0, int((lat + WINDOW_M / my - y0) / py))
    r1 = min(DEM.RasterYSize, int((lat - WINDOW_M / my - y0) / py) + 2)
    a = band.ReadAsArray(c0, r0, c1 - c0, r1 - r0).astype(np.float64)
    if nodata is not None:
        a[a == nodata] = np.nan
    h, w = a.shape
    dx = (x0 + (np.arange(c0, c1) + 0.5) * px - lon) * mx
    dy = (y0 + (np.arange(r0, r1) + 0.5) * py - lat) * my
    near = np.hypot(dx[None, :], dy[:, None]) <= SNAP_M
    out = {"id": row["id"], "dem_z": "", "prom": "", "capped": ""}
    if not near.any() or np.isnan(a[near]).all():
        return out
    start = int(np.nanargmax(np.where(near, a, np.nan)))
    z = float(a.flat[start])
    flat = a.ravel()
    seen = np.zeros(h * w, bool)
    seen[start] = True
    heap = [(-z, start)]
    col, capped = z, False
    while heap:
        neg, i = heapq.heappop(heap)
        v = -neg
        if v > z:
            break  # higher ground: col is the key col
        col = min(col, v)
        y, x = divmod(i, w)
        if y in (0, h - 1) or x in (0, w - 1):
            capped = True  # window edge before higher ground
            break
        for j in (i - w - 1, i - w, i - w + 1, i - 1, i + 1, i + w - 1, i + w, i + w + 1):
            if not seen[j]:
                seen[j] = True
                if not math.isnan(flat[j]):
                    heapq.heappush(heap, (-flat[j], j))
    out.update(dem_z=round(z, 1), prom=round(z - col, 1), capped="t" if capped else "f")
    return out


def main(dem_path: str, peaks_path: str, out_path: str) -> None:
    rows = list(csv.DictReader(open(peaks_path)))
    with Pool(initializer=init, initargs=(dem_path,)) as pool:
        results = pool.map(prominence, rows, chunksize=200)
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, ["id", "dem_z", "prom", "capped"])
        w.writeheader()
        w.writerows(results)


if __name__ == "__main__":
    main(*sys.argv[1:])
