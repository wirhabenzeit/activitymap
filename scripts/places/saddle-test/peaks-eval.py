"""Compare the local prominence with the research prominence (national DEMs) and Wikidata.

usage: peaks-eval.py <peaks.csv> <prom.csv> [<prom2.csv> ...]
"""

import csv
import sys

import numpy as np

P = {r["id"]: r for r in csv.DictReader(open(sys.argv[1]))}
runs = [(p.split("/")[-1], {r["id"]: r for r in csv.DictReader(open(p))}) for p in sys.argv[2:]]
BANDS = (30, 100, 300)


def band(x):
    return int(np.searchsorted(BANDS, x, side="right"))


rank = lambda x: np.argsort(np.argsort(x))
for name, B in runs:
    print(f"== {name}")
    for cc in ("CH", "AT", "IT"):
        ids = [i for i, r in P.items() if r["cc"] == cc and B[i]["prom"] != ""]
        ref = [i for i in ids if P[i]["dem_prom"]]
        b = np.array([float(B[i]["prom"]) for i in ref])
        d = np.array([float(P[i]["dem_prom"]) for i in ref])
        same = np.mean([band(x) == band(y) for x, y in zip(b, d)])
        print(f"{cc}: {len(ids)} peaks, {len(ref)} with research prominence; Spearman {np.corrcoef(rank(b), rank(d))[0, 1]:.2f};"
              f" same band (<30, 30-99, 100-299, >=300) {same:.0%}")
        for t in (30, 100):
            small_ref, small_b = d < t, b < t
            print(f"  below {t} m: research {small_ref.mean():.0%}, local {small_b.mean():.0%};"
                  f" of research-small, local agrees {small_b[small_ref].mean():.0%};"
                  f" of research->= {t}, local wrongly small {small_b[~small_ref].mean():.0%}")
        # Peaks where the research run found no summit with >= 10 m prominence within 250 m.
        none = [float(B[i]["prom"]) for i in ids if not P[i]["dem_prom"]]
        if none:
            n = np.array(none)
            print(f"  no research summit ({len(n)}): local < 30 m for {np.mean(n < 30):.0%}, median {np.median(n):.0f} m")
        # Wikidata as an independent check.
        wd = [(float(B[i]["prom"]), float(P[i]["wd_prom"]), P[i]["dem_prom"]) for i in ids if P[i]["wd_prom"]]
        if wd:
            wb, wp, wr = np.array([x[0] for x in wd]), np.array([x[1] for x in wd]), [x[2] for x in wd]
            ok = lambda est, true: np.abs(est - true) <= np.maximum(25, 0.1 * true)
            rr = np.array([float(x) if x else np.nan for x in wr])
            m = wp < 300  # the local value is capped for peaks dominating the window; compare where it matters
            print(f"  Wikidata < 300 m (n={m.sum()}): within 25 m/10%: local {ok(wb[m], wp[m]).mean():.0%},"
                  f" research {np.nanmean(np.where(np.isnan(rr[m]), np.nan, ok(rr[m], wp[m]))):.0%};"
                  f" local says < 30 m for {np.mean(wb[m & (wp >= 30)] < 30):.0%} of Wikidata >= 30 m")
