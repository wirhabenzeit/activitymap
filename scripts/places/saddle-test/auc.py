"""How well does each signal separate gazetteer passes from the rest (CH, AT)?
usage: auc.py <passes.csv> <amp.csv> [<amp2.csv> ...]"""
import csv, sys
import numpy as np
P = {r["id"]: r for r in csv.DictReader(open(sys.argv[1]))}
amps = []
for path in sys.argv[2:]:
    amps.append({r["id"]: r for r in csv.DictReader(open(path))})
def auc(score, label):
    o = np.argsort(score); s = np.asarray(score)[o]; l = np.asarray(label)[o]
    ranks = np.empty(len(s)); ranks[o] = np.arange(1, len(s) + 1)
    # average ranks for ties
    _, inv, cnt = np.unique(score, return_inverse=True, return_counts=True)
    sums = np.bincount(inv, ranks); ranks = (sums / cnt)[inv]
    lab = np.asarray(label); n1 = lab.sum(); n0 = len(lab) - n1
    return (ranks[lab].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)
for cc in ("CH", "AT"):
    ids = [i for i, r in P.items() if r["cc"] == cc and r["sig"]]
    lab = [P[i]["gaz"] == "t" for i in ids]
    alt = lambda i: float(P[i]["elevation_m"] or amps[0][i]["dem_z"])
    sig = [float(P[i]["sig"]) for i in ids]
    print(f"{cc} (n={len(ids)}, gazetteer {np.mean(lab):.0%}) AUC for predicting gazetteer membership:")
    print(f"  research depth (national DEM, Kirmse) {auc(sig, lab):.3f}")
    for path, A in zip(sys.argv[2:], amps):
        a = [float(A[i]["amp"]) for i in ids]
        print(f"  circle amp {path.split('/')[-1]:<12}          {auc(a, lab):.3f}")
    print(f"  elevation alone                       {auc([alt(i) for i in ids], lab):.3f}")
    wd = [P[i]["has_wikidata"] == "t" or P[i]["has_wikipedia"] == "t" for i in ids]
    print(f"  Wikidata/Wikipedia share: gazetteer {np.mean([w for w,l in zip(wd,lab) if l]):.0%}, other {np.mean([w for w,l in zip(wd,lab) if not l]):.0%}")
    sub = [P[i]["subtypes"] for i in ids]
    for st in sorted(set(sub)):
        m = [s == st for s in sub]
        print(f"  subtype {st:<32} n={sum(m):>5}  in gazetteer {np.mean([l for l, k in zip(lab, m) if k]):.0%}")
