"""Global rule: hide junk names; hide low crossings with little relief; keep the rest.
Fit on CH+AT agreed decisions (Italy's agreed labels are not trusted), report all three.
usage: rule.py <passes.csv> <amp.csv> [alt amp]"""
import csv, re, sys
import numpy as np
P = {r["id"]: r for r in csv.DictReader(open(sys.argv[1]))}
for r in csv.DictReader(open(sys.argv[2])): P[r["id"]].update(r)
rows = list(P.values())
# Elevation labels and placeholders used as names: "q. 2699", "P2650", "Pt. 2345", "2345", "sea".
JUNK = re.compile(r"^\s*((q|quota|p|pt|pkt|punkt|cota|kote)\.?\s*)?\d{3,4}(\s*m)?\s*$|^(sea|pass|passo|sattel|col|colle|forcella|bocchetta|joch)$", re.I)
def alt(r): return float(r["elevation_m"]) if r["elevation_m"] else float(r["dem_z"])
def wiki(r): return r["has_wikipedia"] == "t" or r["has_wikidata"] == "t"
def junk(r): return bool(JUNK.match(r["display_name"]))
def keep(r, A, T):
    if junk(r) and not wiki(r): return False
    return alt(r) >= A or float(r["amp"]) >= T or wiki(r)
def score(A, T, ccs=("CH", "AT")):
    return np.mean([np.mean([keep(r, A, T) == (r["cat"] != "hide") for r in rows if r["cc"] == cc]) for cc in ccs])
if len(sys.argv) > 3: A, T = map(float, sys.argv[3:5])
else: A, T = max(((a, t) for a in range(600, 2201, 100) for t in range(20, 301, 10)), key=lambda p: score(*p))
print(f"junk names (not in wiki): {sum(junk(r) and not wiki(r) for r in rows)}, e.g.",
      sorted({r['display_name'] for r in rows if junk(r)})[:12])
print(f"\nRule: hide junk names; keep if elevation >= {A:.0f} m, or circle amp >= {T:.0f} m, or Wikipedia/Wikidata")
for cc in ("CH", "AT", "IT"):
    rs = [r for r in rows if r["cc"] == cc]
    k = np.array([keep(r, A, T) for r in rs]); g = np.array([r["cat"] != "hide" for r in rs])
    gaz = np.array([r["gaz"] == "t" for r in rs])
    extra = f"  gazetteer kept {k[gaz].mean():.1%}  non-gazetteer hidden {1-k[~gaz].mean():.0%}" if gaz.any() else ""
    print(f"  {cc}: agree {np.mean(k==g):.1%}  hidden {(~k).sum()} ({1-k.mean():.0%}; agreed {1-g.mean():.0%})"
          f"  wrongly hidden {(~k&g).sum()}  wrongly kept {(k&~g).sum()}{extra}")
import random; random.seed(3)
for cc in ("CH", "AT", "IT"):
    for title, cond in (("hidden", lambda r: not keep(r, A, T)), ("hidden but agreed keep", lambda r: not keep(r, A, T) and r["cat"] != "hide"),
                        ("kept but agreed hide", lambda r: keep(r, A, T) and r["cat"] == "hide")):
        rs = [r for r in rows if r["cc"] == cc and cond(r)]
        if not rs: continue
        ex = random.sample(rs, min(8, len(rs)))
        print(f"{cc} {title} ({len(rs)}): " + "; ".join(f"{r['display_name'][:24]} {alt(r):.0f}m amp{float(r['amp']):.0f}" for r in ex))
