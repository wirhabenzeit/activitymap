"""Low-elevation passes (< 1,200 m, CH+AT): does cheap relief reproduce the agreed keep/hide?
usage: low.py <passes.csv> <amp.csv> [<amp.csv> ...]"""
import csv, sys
import numpy as np
P = {r["id"]: r for r in csv.DictReader(open(sys.argv[1]))}
sets = [{r["id"]: r for r in csv.DictReader(open(p))} for p in sys.argv[2:]]
def alt(i): return float(P[i]["elevation_m"] or sets[0][i]["dem_z"])
def wiki(i): return P[i]["has_wikipedia"] == "t" or P[i]["has_wikidata"] == "t"
def auc(score, lab):
    s = np.asarray(score, float); l = np.asarray(lab)
    _, inv, cnt = np.unique(s, return_inverse=True, return_counts=True)
    ranks = np.empty(len(s)); ranks[np.argsort(s, kind="stable")] = np.arange(1, len(s) + 1)
    ranks = (np.bincount(inv, ranks) / cnt)[inv]; n1 = l.sum(); n0 = len(l) - n1
    return (ranks[l].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)
for cc in ("CH", "AT", "IT"):
    ids = [i for i, r in P.items() if r["cc"] == cc and alt(i) < 1200 and not wiki(i)]
    g = np.array([P[i]["cat"] != "hide" for i in ids]); gaz = np.array([P[i]["gaz"] == "t" for i in ids])
    print(f"{cc} below 1,200 m, no wiki: n={len(ids)}, agreed hide {1-g.mean():.0%}" + (f", in gazetteer {gaz.mean():.0%}" if gaz.any() else ""))
    sig_ids = [i for i in ids if P[i]["sig"]]
    gs = np.array([P[i]["cat"] != "hide" for i in sig_ids]); gzs = np.array([P[i]["gaz"] == "t" for i in sig_ids])
    lab = gzs if gzs.any() else gs
    what = "gazetteer membership" if gzs.any() else "agreed keep"
    print(f"  AUC for {what} (n={len(sig_ids)}): research depth {auc([float(P[i]['sig']) for i in sig_ids], lab):.3f}  "
          + "  ".join(f"{p.split('/')[-1]} {auc([float(s[i]['amp']) for i in sig_ids], lab):.3f}" for p, s in zip(sys.argv[2:], sets)))
    for p, s in zip(sys.argv[2:], sets):
        a = np.array([float(s[i]["amp"]) for i in ids])
        best = max(range(10, 201, 5), key=lambda t: np.mean((a >= t) == g))
        k = a >= best
        print(f"  {p.split('/')[-1]}: best amp >= {best}: agree {np.mean(k==g):.1%}, hides {(~k).sum()} (agreed {(~g).sum()})"
              + (f", gazetteer kept {k[gaz].mean():.0%}, non-gazetteer hidden {1-k[~gaz].mean():.0%}" if gaz.any() else ""))
