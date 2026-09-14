#!/usr/bin/env python3
"""
Merge new quarterly genart CSVs into the existing (lite) dashboard/data.js.

Context: the full raw history was lost when the container reset, but the lite
data.js keeps the FULL brand-level facts for every prior genart/quarter (only
the article-level long tail is capped). So we use the current data.js as the
baseline, decode it back to records, add the new raw CSVs (parsed fully, then
capped like the lite build), rebuild the dimension indices and re-emit data.js
in the exact same lite schema.

Usage:  python3 merge_new_data.py
        (reads dashboard/data.js as baseline + data/raw/*.csv new files)
"""
import csv, io, json, os, re, glob
from collections import defaultdict

HERE = os.path.dirname(__file__)
DATA_JS = os.path.join(HERE, "dashboard", "data.js")
RAW = os.path.join(HERE, "data", "raw")
NOGEO_CODE = "__ALL__"
TOP_ART_LITE = 120

# labels for the newly added generic articles
NEW_GENART_LABELS = {
    "479": "Clutch Kit",
    "1561": "Window Regulator",
    "4921": "Oil Change Kit (Auto Trans.)",
}

# ---- load baseline -------------------------------------------------------
raw = open(DATA_JS, encoding="utf-8").read()
D = json.loads(re.search(r"window\.TM_DATA\s*=\s*(\{.*\});?\s*$", raw, re.DOTALL).group(1))

OUR = D["meta"]["ourBrands"]; AGG = D["meta"]["aggBrands"]
_norm = lambda s: (s or "").upper().replace("Ö", "O").replace("Ø", "O").strip()
OURSET = {_norm(b) for b in OUR}; AGGSET = {_norm(b) for b in AGG}

gcode = [g["code"] for g in D["dims"]["genart"]]
glabel = {g["code"]: g["label"] for g in D["dims"]["genart"]}
period = list(D["dims"]["period"])
mkt = D["dims"]["market"]                     # keep full entries (label/countries/noGeo)
mkt_by_code = {m["code"]: m for m in mkt}
brand = D["dims"]["brand"]
bname = [b["name"] for b in brand]
bflag = {b["name"]: {"ours": b["ours"], "agg": b["agg"]} for b in brand}
nart = list(D["dims"]["nartnr"])
geo = set(D.get("geoPeriods", []))

# decode baseline facts into name/code-keyed aggregations
brand_agg = {}    # (g,p,m,bn) -> qty
for gi, pi, mi, bi, q in D["brandFacts"]:
    brand_agg[(gcode[gi], period[pi], mkt[mi]["code"], bname[bi])] = q
article_agg = {}  # (g,p,m,bn,nartnr) -> qty
for gi, pi, mi, bi, ni, q in D["articleFacts"]:
    article_agg[(gcode[gi], period[pi], mkt[mi]["code"], bname[bi], nart[ni])] = q
# baseline distinct (keep as-is, keyed by code/period)
distinct = defaultdict(dict)   # gcode -> {period -> count}
for gk, pd in (D.get("articleDistinct") or {}).items():
    gc = gcode[int(gk)]
    for pk, c in pd.items():
        distinct[gc][period[int(pk)]] = c

# ---- parse new raw CSVs --------------------------------------------------
def is_int(s):
    try: int(s); return True
    except: return False

def rows(path):
    out = []
    with open(path, encoding="utf-8-sig") as f:
        f.readline()
        for line in f:
            line = line.rstrip("\r\n")
            if not line: continue
            out.append(next(csv.reader(io.StringIO(line), delimiter=";")))
    return out

def note_brand(name, dlnr):
    fl = bflag.setdefault(name, {"ours": _norm(name) in OURSET, "agg": False})
    if _norm(name) in AGGSET or (dlnr or "").strip().startswith("-"):
        fl["agg"] = True

new_article_full = defaultdict(int)   # (g,p,m,bn,nartnr) -> qty  (new genarts, full)
new_brand = {}                        # (g,p,m,bn) -> qty
for p in sorted(glob.glob(os.path.join(RAW, "*.csv"))):
    base = os.path.basename(p)
    if not re.search(r"(479|1561|4921)", base):     # only the newly added genarts
        continue
    for r in rows(p):
        if not r or not r[0].strip() or r[0].strip().upper() == "GENART":
            continue
        if len(r) >= 7:            # article: G;LDATE;LKZ;DLNR;DLNRBEZ;NARTNR;QTY
            g, pr, m, dlnr, b, n, q = r[0], r[1], r[2], r[3], r[4], r[5], r[6]
            try: q = int(q)
            except: continue
            note_brand(b, dlnr); geo.add(pr)
            new_article_full[(g, pr, m, b, n)] += q
        elif len(r) == 6 and not is_int(r[2]):   # brand: G;LDATE;LKZ;DLNR;DLNRBEZ;QTY
            g, pr, m, dlnr, b, q = r[0], r[1], r[2], r[3], r[4], r[5]
            try: q = int(q)
            except: continue
            note_brand(b, dlnr); geo.add(pr)
            new_brand[(g, pr, m, b)] = new_brand.get((g, pr, m, b), 0) + q

# new genart distinct (from full) + lite cap of article rows
combo_tot = defaultdict(int)
dset = defaultdict(lambda: defaultdict(set))
for (g, pr, m, b, n), q in new_article_full.items():
    combo_tot[(g, pr, n, b)] += q
    if not bflag.get(b, {}).get("agg"):
        dset[g][pr].add((n, b))
keep = set()
bygp = defaultdict(list)
for (g, pr, n, b), t in combo_tot.items():
    bygp[(g, pr)].append(((g, pr, n, b), t))
for lst in bygp.values():
    lst.sort(key=lambda x: -x[1])
    for combo, _t in lst[:TOP_ART_LITE]:
        keep.add(combo)
for (g, pr, m, b, n), q in new_article_full.items():
    if (g, pr, n, b) in keep:
        article_agg[(g, pr, m, b, n)] = article_agg.get((g, pr, m, b, n), 0) + q
for g, pd in dset.items():
    for pr, s in pd.items():
        distinct[g][pr] = len(s)

# merge brand facts + ensure genart/period/market present
for k, q in new_brand.items():
    brand_agg[k] = q
    if k[3] not in bflag:
        note_brand(k[3], "")

# ---- rebuild dimensions --------------------------------------------------
genarts = sorted({k[0] for k in brand_agg} | {k[0] for k in article_agg},
                 key=lambda x: int(x) if x.lstrip("-").isdigit() else 1e9)
periods = sorted({k[1] for k in brand_agg} | {k[1] for k in article_agg})
mkcodes = {k[2] for k in brand_agg} | {k[2] for k in article_agg}
real = sorted(c for c in mkcodes if c != NOGEO_CODE)
market_codes = real + ([NOGEO_CODE] if NOGEO_CODE in mkcodes else [])
brands = sorted({k[3] for k in brand_agg} | {k[3] for k in article_agg})
nartnrs = sorted({k[4] for k in article_agg})

gi = {v: i for i, v in enumerate(genarts)}
pi = {v: i for i, v in enumerate(periods)}
mi = {v: i for i, v in enumerate(market_codes)}
bi = {v: i for i, v in enumerate(brands)}
ni = {v: i for i, v in enumerate(nartnrs)}

def market_entry(code):
    if code in mkt_by_code:
        return mkt_by_code[code]
    if code == NOGEO_CODE:
        return {"code": code, "label": "All markets (no country split)", "countries": [], "noGeo": True}
    return {"code": code, "label": code, "countries": [], "noGeo": False}

out = {
    "meta": {"generatedFrom": D["meta"].get("generatedFrom", []) +
             ["2026Q1/Q2 Clutch Kit 479", "2026Q1/Q2 Window Regulator 1561", "2026Q1 Oil Change Kit 4921"],
             "ourBrands": OUR, "aggBrands": AGG, "lite": True},
    "dims": {
        "genart": [{"code": g, "label": glabel.get(g, NEW_GENART_LABELS.get(g, "GENART " + g))} for g in genarts],
        "period": periods,
        "market": [market_entry(c) for c in market_codes],
        "brand": [{"name": b, "ours": bflag[b]["ours"], "agg": bflag[b]["agg"]} for b in brands],
        "nartnr": nartnrs,
    },
    "geoPeriods": sorted(geo),
    "articleGenarts": sorted({k[0] for k in article_agg}, key=lambda x: int(x) if x.lstrip("-").isdigit() else 1e9),
    "brandFacts": [[gi[g], pi[p], mi[m], bi[b], q] for (g, p, m, b), q in brand_agg.items()],
    "articleFacts": [[gi[g], pi[p], mi[m], bi[b], ni[n], q] for (g, p, m, b, n), q in article_agg.items()],
    "articleDistinct": {gi[g]: {pi[p]: c for p, c in pd.items()} for g, pd in distinct.items()},
}

with open(DATA_JS, "w", encoding="utf-8") as f:
    f.write("// AUTO-GENERATED (merged) - do not edit by hand.\n")
    f.write("window.TM_DATA = ")
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

print("genarts :", [(g, out['dims']['genart'][i]['label']) for i, g in enumerate(genarts)])
print("periods :", periods, " geo:", sorted(geo))
print("brands  :", len(brands), " markets:", len(market_codes), " articles:", len(nartnrs))
print("brandFacts:", len(out['brandFacts']), " articleFacts:", len(out['articleFacts']))
print("size KB :", round(os.path.getsize(DATA_JS)/1024))
