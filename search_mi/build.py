#!/usr/bin/env python3
"""Build the Search & Market Indicator dashboard into one self-contained HTML file.

The dashboard's dataset is the union of two sources:

  * ``search_mi/data_legacy.json`` -- product groups 82 / 273 / 402 / 854 / 914.
    Their raw quarterly CSVs were never recovered (see README persistence note),
    so this file *is* the record for them and is copied through untouched.

  * ``data/raw_search_mi/<genart>/<quarter>/`` -- the raw TopMotive quarterly
    exports for the product groups added later, one folder per delivered
    quarter. Everything the dashboard shows for these is derived here, so
    re-running this script reproduces the dataset exactly.

Run:  python3 search_mi/build.py
Out:  search_mi/Search_MI_Dashboard.html
"""

import csv
import io
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw_search_mi")
HERE = os.path.join(ROOT, "search_mi")

# --------------------------------------------------------------------------
# Product groups built from raw CSVs.
#   genart -> (label, TecDoc supplier number of the analysed ZF brand, ZF brand)
# The DS<n> in every filename is that supplier number, e.g. DS32 = SACHS.
# --------------------------------------------------------------------------
NEW_PRODUCTS = {
    "479": ("Clutch Kit", "32", "SACHS"),
    "1561": ("Window Regulator", "35", "LEMFÖRDER"),
    "4921": ("Oil Change Kit (Auto Trans.)", "68", "ZF"),
}

# how many rows to keep per (period, product) for the list-style sections
TOP_VBRAND = 20
TOP_VEHICLE = 15
TOP_ARTICLE = 15
TOP_GAP_VEH = 12
TOP_GAP_ART = 25


# ---------------------------------------------------------------- utilities
def read_csv(path):
    """Read a semicolon-separated TopMotive export.

    The dvse_* exports are UTF-8 with a BOM. The arc_* exports are plain ASCII
    in which every non-ASCII character has already been flattened to '?'
    upstream, so they are read as-is and repaired later via fix_name().
    """
    with io.open(path, encoding="utf-8-sig", errors="replace", newline="") as fh:
        return [r for r in csv.reader(fh, delimiter=";") if r]


def find(folder, prefix, optional=False):
    """Locate the one raw file in a period folder whose name starts with prefix.

    ``prefix`` may be a tuple of alternatives -- the MI_TOP10 export is named
    ``arc_MI_TOP10_*`` in the quarterly deliveries but ``MI_TOP10_*Tshirt*`` in
    the 2024 full-year one.
    """
    prefixes = (prefix,) if isinstance(prefix, str) else tuple(prefix)
    hits = sorted(f for f in os.listdir(folder)
                  if f.endswith(".csv") and f.startswith(prefixes))
    if not hits and optional:
        return None
    if len(hits) != 1:
        raise SystemExit("expected exactly one %r file in %s, found %s"
                         % (prefix, folder, hits))
    return os.path.join(folder, hits[0])


def quarter_folders(genart):
    """Every delivered-quarter folder for a product group, oldest first."""
    d = os.path.join(RAW, genart)
    if not os.path.isdir(d):
        raise SystemExit("no raw data folder for product group %s at %s" % (genart, d))
    subs = sorted(f for f in os.listdir(d) if os.path.isdir(os.path.join(d, f)))
    if not subs:
        raise SystemExit("%s has no quarter sub-folders (expected e.g. %s/2026Q1/)"
                         % (d, genart))
    return [os.path.join(d, s) for s in subs]


def period_from_filename(name):
    """Read the delivered period from a filename's date range.

    '..._01042026_30062026.csv' -> 'Q2 2026'
    '..._01012024_31122024.csv' -> 'FY 2024'  (a full-year delivery)
    """
    m = re.search(r"_(\d{2})(\d{2})(\d{4})_(\d{2})(\d{2})(\d{4})\.csv$", name)
    if not m:
        raise SystemExit("cannot read a period from filename %r" % name)
    d1, m1, y1, d2, m2, y2 = (int(m.group(i)) for i in (1, 2, 3, 4, 5, 6))
    if y1 != y2:
        raise SystemExit("date range spans years in %r" % name)
    if (m1, d1, m2, d2) == (1, 1, 12, 31):
        return "FY %d" % y1
    if (m2 - m1) != 2 or d1 != 1:
        raise SystemExit("date range in %r is neither one quarter nor one year" % name)
    return "Q%d %d" % ((m1 - 1) // 3 + 1, y1)


def period_sort_key(period):
    """Chronological order; a full year sorts before that year's quarters."""
    kind, year = period.split()
    return (int(year), 0 if kind == "FY" else int(kind[1]))


def folder_name_for(period):
    """'Q2 2026' -> '2026Q2';  'FY 2024' -> '2024FY'."""
    kind, year = period.split()
    return "%s%s" % (year, kind)


def ldate_for(period):
    """The LDATE value the basket export should carry for this period."""
    kind, year = period.split()
    return year if kind == "FY" else "%s/%s" % (year, kind[1])


def num(v):
    """Parse a TopMotive numeric cell ('', '1.234', '87,76') to int/float."""
    v = (v or "").strip().strip('"')
    if not v:
        return 0
    v = v.replace(".", "").replace(",", ".") if re.match(r"^-?[\d.]+,\d+$", v) else v
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return 0


def read_brand_table(folder):
    """{supplier number -> brand name} from a period's basket export.

    The quarterly export is GENART;LDATE;LKZ;DLNR;DLNRBEZ;QTY_POS while the
    2024 full-year one drops LKZ, so the columns are located by header name.
    """
    rows = read_csv(find(folder, "dvse_BSK_DLNRGenart"))
    hdr = [h.strip('"').upper() for h in rows[0]]
    try:
        i_nr, i_name = hdr.index("DLNR"), hdr.index("DLNRBEZ")
    except ValueError:
        raise SystemExit("basket export in %s has no DLNR/DLNRBEZ columns: %s" % (folder, hdr))
    return {row[i_nr].strip('"'): row[i_name].strip('"')
            for row in rows[1:] if len(row) > max(i_nr, i_name)}


def build_name_repair(brands):
    """Map '?'-flattened brand names in the arc_* files back to real names.

    The dvse_* files are proper UTF-8 and carry the same brand names, so they
    supply the vocabulary: 'LEMF?RDER' -> 'LEMFÖRDER'.
    """
    vocab = set(brands.values())

    def repair(name):
        name = name.strip().strip('"')
        if "?" not in name:
            return name
        pat = re.compile("^" + "".join("." if c == "?" else re.escape(c) for c in name) + "$", re.I)
        hits = [v for v in vocab if pat.match(v)]
        return hits[0] if len(hits) == 1 else name

    return repair


def build_canonical_names(genart):
    """{old brand name -> current brand name} for one product group.

    TecDoc suppliers get renamed between deliveries -- supplier 6 is 'LuK' in
    the 2024 files and 'Schaeffler LuK' from 2026 on. Keyed on the supplier
    number, so a trend line follows the supplier rather than breaking at the
    rename. Names that map to more than one supplier are left alone.
    """
    per_period = [read_brand_table(f) for f in quarter_folders(genart)]
    newest = {}                      # supplier number -> most recent name
    for table in per_period:         # folders come oldest first
        newest.update(table)
    owners = defaultdict(set)        # name -> supplier numbers that ever used it
    for table in per_period:
        for nr, name in table.items():
            owners[name].add(nr)
    alias = {}
    for table in per_period:
        for nr, name in table.items():
            current = newest.get(nr)
            if current and current != name and len(owners[name]) == 1:
                alias[name] = current
    return alias


def zf_column(header, zf_brand, repair):
    """Index of the analysed ZF brand's column in an arc_* gap-scoring header."""
    for i, h in enumerate(header[5:], 5):
        if repair(h).upper() == zf_brand.upper():
            return i
    raise SystemExit("ZF brand %r not among gap-scoring columns %s" % (zf_brand, header[5:]))


def pc(part, whole, digits=2):
    return round(part / whole * 100, digits) if whole else 0.0


# ------------------------------------------------------------ per-product ETL
def build_quarter(genart, zf_brand, folder, out, alias):
    brands = read_brand_table(folder)
    repair = build_name_repair(brands)

    def brand_name(raw):
        name = repair(raw)
        return alias.get(name, name)

    f_mi = find(folder, ("arc_MI_TOP10_", "MI_TOP10_"))
    f_ads = find(folder, "dvse_ADS+")
    f_kty = find(folder, "dvse_KTypGap")
    f_bsk = find(folder, "dvse_BSK_DLNRGenart")
    # the 2024 full-year delivery has no gap-scoring exports
    f_art = find(folder, "arc_artdir_gap_scoring_", optional=True)
    f_veh = find(folder, "arc_vehicle_gap_scoring_", optional=True)

    period = period_from_filename(os.path.basename(f_ads))
    for f in (f_mi, f_veh, f_art, f_kty, f_bsk):
        if f and period_from_filename(os.path.basename(f)) != period:
            raise SystemExit("mixed periods in %s" % folder)

    # cross-check the filename period against LDATE in the basket export
    ldates = {r[1].strip('"') for r in read_csv(f_bsk)[1:] if len(r) > 1}
    want = ldate_for(period)
    if ldates != {want}:
        raise SystemExit("period mismatch in %s: filenames say %s (LDATE %s), file has %s"
                         % (folder, period, want, sorted(ldates)))
    # the folder name must agree too, so a misfiled delivery fails the build
    expect_dir = folder_name_for(period)
    if os.path.basename(folder) != expect_dir:
        raise SystemExit("folder %s holds %s data (expected folder name %s)"
                         % (folder, period, expect_dir))
    if bool(f_art) != bool(f_veh):
        raise SystemExit("%s has only one of the two gap-scoring exports" % folder)
    # 'scored' = coverage read from the gap-scoring exports (the quarterly
    # deliveries); 'rules' = coverage computed from R1/R2 over ADS+/KTypGap,
    # which is how ZF's own 2024 summary derives it.
    basis = "scored" if f_art else "rules"

    # ---- Market Indicator (MI_TOP10) -------------------------------------
    for row in read_csv(f_mi)[1:]:
        if len(row) < 3:
            continue
        brand = brand_name(row[1])
        out["mi"].append({"period": period, "ga": genart, "brand": brand,
                          "pos": num(row[0]), "score": round(float(num(row[2])), 2),
                          "zf": brand in ZF_BRANDS})

    # ---- vehicle master data (KType -> manufacturer / model, article count)
    ktyp, ktyp_rows = {}, []
    for r in read_csv(f_kty)[1:]:
        if len(r) > 6:
            typenr = r[2].strip('"')
            ktyp[typenr] = (r[5].strip('"'), r[6].strip('"'))
            ktyp_rows.append((typenr, num(r[3]), num(r[4])))   # TYPENR, BSK_POS, ART_CNT

    # ---- article direction: basket coverage ------------------------------
    covering = {}
    if f_art:
        art = read_csv(f_art)
        a_hdr, a_abs = art[0], art[1]
        a_zf = zf_column(a_hdr, zf_brand, repair)
        art_basket = num(a_abs[3])      # total GENART_QTY_POS across all search words
        art_cov = num(a_abs[a_zf])      # of which covered by the ZF brand's range
        # brand columns are 0/1 flags per search word; keep only the ZF ones
        zf_cols = {i: brand_name(h) for i, h in enumerate(a_hdr[5:], 5)
                   if brand_name(h) in ZF_BRANDS}
        art_rows = [r for r in art[3:] if len(r) > max(zf_cols or {a_zf: 0})]
        covering = {r[2].strip('"'): sorted(b for i, b in zf_cols.items() if num(r[i]) > 0)
                    for r in art_rows}

    # ---- vehicle direction: basket coverage ------------------------------
    if f_veh:
        veh = read_csv(f_veh)
        v_hdr, v_abs = veh[0], veh[1]
        v_zf = zf_column(v_hdr, zf_brand, repair)
        veh_demand = num(v_abs[3])      # total BSK_POS across all vehicle types
        veh_cov = num(v_abs[v_zf])
        veh_rows = [(r[2].strip('"'), num(r[3]), num(r[v_zf])) for r in veh[3:] if len(r) > v_zf]
    else:
        # Rule R2: a vehicle is served when the analysed brand has ART_CNT > 0.
        # ART_CNT was verified to equal the brand's gap-scoring column for every
        # KType in the quarterly deliveries, so this is the same signal.
        veh_rows = ktyp_rows
        veh_demand = sum(b for _, b, _ in veh_rows)
        veh_cov = sum(b for _, b, c in veh_rows if c > 0)

    # ---- article search log (ADS+) ---------------------------------------
    ads = read_csv(f_ads)
    ix = {k.strip('"'): i for i, k in enumerate(ads[0])}

    def cell(r, key):
        return num(r[ix[key]])

    ads_rows = [r for r in ads[1:] if len(r) >= len(ads[0])]
    art_searches = sum(cell(r, "SUMMCNT") for r in ads_rows)

    # Rule R1 (concept doc): not found = SA200 == 0 AND SA203FF == 0
    def not_found(r):
        return cell(r, "SA200") == 0 and cell(r, "SA203FF") == 0

    art_found_searches = sum(cell(r, "SUMMCNT") for r in ads_rows if not not_found(r))
    # Indicator IN1: apply R1 and GENART_DLNR_QTY_POS > 0
    in1 = sum(cell(r, "SUMMCNT") for r in ads_rows
              if not_found(r) and cell(r, "GENART_DLNR_QTY_POS") > 0)
    oe = sum(cell(r, "SUMMCNT") for r in ads_rows if cell(r, "U4_OE") == 1)

    if not f_art:
        # No gap-scoring export: fall back to Rule R1 over the basket positions
        # in ADS+. This is exactly how ZF's own 2024 summary workbook computes
        # "ZF Product in Search Result" (verified row-for-row against it).
        art_basket = sum(cell(r, "GENART_QTY_POS") for r in ads_rows)
        art_cov = sum(cell(r, "GENART_QTY_POS") for r in ads_rows if not not_found(r))

    out["coverage"].append({
        "period": period, "ga": genart, "brand": zf_brand, "basis": basis,
        "art_basket": art_basket, "art_cov": art_cov, "art_mi": pc(art_cov, art_basket),
        "art_searches": art_searches, "art_found_searches": art_found_searches, "in1": in1,
        "veh_demand": veh_demand, "veh_cov": veh_cov, "veh_mi": pc(veh_cov, veh_demand),
        "combined_mi": pc(art_cov + veh_cov, art_basket + veh_demand),
    })
    out["volume"].append({"period": period, "ga": genart,
                          "art_searches": art_searches, "veh_demand": veh_demand})
    out["oe"].append({"period": period, "ga": genart,
                      "oe": oe, "non_oe": art_searches - oe})

    # ---- demand by vehicle manufacturer and by model ---------------------
    by_maker, by_model = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    for typenr, bsk, cov in veh_rows:
        if typenr not in ktyp:
            continue                     # no master record -> cannot be labelled
        maker, model = ktyp[typenr]
        for agg, key in ((by_maker, maker), (by_model, "%s %s" % (maker, model))):
            agg[key][0] += bsk
            if cov > 0:
                agg[key][1] += bsk

    for maker, (dem, cov) in sorted(by_maker.items(), key=lambda kv: -kv[1][0])[:TOP_VBRAND]:
        out["vbrand"].append({"period": period, "ga": genart, "zf": zf_brand,
                              "vb": maker, "demand": dem, "cov": cov})
    for model, (dem, cov) in sorted(by_model.items(), key=lambda kv: -kv[1][0])[:TOP_VEHICLE]:
        out["vehicle"].append({"period": period, "ga": genart,
                               "vehicle": model, "demand": dem, "cov": cov})

    # ---- vehicles with demand the ZF range does not serve (Rule R2) ------
    gaps = [(t, b) for t, b, c in veh_rows if c == 0 and t in ktyp and b > 0]
    for typenr, bsk in sorted(gaps, key=lambda x: -x[1])[:TOP_GAP_VEH]:
        maker, model = ktyp[typenr]
        out["gap_veh"].append({"period": period, "ga": genart,
                               "vehicle": "%s - %s %s" % (typenr, maker, model),
                               "demand": bsk})

    # ---- most-searched article numbers -----------------------------------
    top_art = sorted(ads_rows, key=lambda r: -cell(r, "SUMMCNT"))[:TOP_ARTICLE]
    for r in top_art:
        out["article"].append({"period": period, "ga": genart,
                               "search": r[ix["NORMSEARCHWORD"]].strip('"'),
                               "demand": cell(r, "SUMMCNT"),
                               "found": 0 if not_found(r) else 1,
                               "oe": 1 if cell(r, "U4_OE") == 1 else 0})

    # ---- searched numbers missing from the ZF range (Rule R1) ------------
    missing = sorted((r for r in ads_rows if not_found(r)), key=lambda r: -cell(r, "SUMMCNT"))
    for r in missing[:TOP_GAP_ART]:
        word = r[ix["NORMSEARCHWORD"]].strip('"')
        gq = cell(r, "GENART_QTY_POS")
        row = {"period": period, "ga": genart, "search": word,
               "demand": cell(r, "SUMMCNT"), "gq": gq, "pct": pc(gq, art_basket),
               "oe": 1 if cell(r, "U4_OE") == 1 else 0}
        # the gap-scoring export may still flag ZF cover for a number R1 calls
        # missing; surface that conflict rather than hiding it
        found_in = covering.get(word) or []
        if found_in:
            row["found_brands"] = found_in
        out["gap_art"].append(row)

    return period


# ------------------------------------------------------------------- driver
def main():
    legacy_path = os.path.join(HERE, "data_legacy.json")
    with io.open(legacy_path, encoding="utf-8") as fh:
        data = json.load(fh)

    global ZF_BRANDS
    ZF_BRANDS = set(data["zf_brands"])

    # product groups added from raw CSVs must not silently overwrite legacy ones
    clash = set(NEW_PRODUCTS) & set(data["products"])
    if clash:
        raise SystemExit("product group(s) %s already present in data_legacy.json" % sorted(clash))

    built = {}
    for genart, (label, ds, zf_brand) in sorted(NEW_PRODUCTS.items(), key=lambda kv: int(kv[0])):
        if zf_brand not in ZF_BRANDS:
            raise SystemExit("%r is not in zf_brands" % zf_brand)
        data["products"][genart] = label
        alias = build_canonical_names(genart)
        periods = [build_quarter(genart, zf_brand, f, data, alias)
                   for f in quarter_folders(genart)]
        if len(set(periods)) != len(periods):
            raise SystemExit("product group %s has duplicate periods: %s" % (genart, periods))
        built[genart] = periods
        renamed = "  [%s]" % ", ".join("%s->%s" % kv for kv in sorted(alias.items())) if alias else ""
        print("  %-5s %-30s %-26s (ZF brand %s, DS%s)%s"
              % (genart, label, ", ".join(periods), zf_brand, ds, renamed))

    # a full-year delivery predates the quarterly series, so it leads the axis
    for periods in built.values():
        for p in periods:
            if p not in data["periods"]:
                if not p.startswith("FY "):
                    raise SystemExit("period %r is not in the dashboard's period list" % p)
                data["periods"].insert(0, p)
    data["periods"] = sorted(set(data["periods"]), key=period_sort_key)
    # tell the dashboard which periods are full years rather than quarters
    data["period_kind"] = {p: ("year" if p.startswith("FY ") else "quarter")
                           for p in data["periods"]}

    # keep the product dropdown in genart order
    data["products"] = {k: data["products"][k]
                        for k in sorted(data["products"], key=int)}

    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with io.open(os.path.join(HERE, "template.html"), encoding="utf-8") as fh:
        html = fh.read()
    if "__TM_SEARCH_MI_DATA__" not in html:
        raise SystemExit("template.html has no __TM_SEARCH_MI_DATA__ placeholder")
    html = html.replace("__TM_SEARCH_MI_DATA__", payload)

    out_path = os.path.join(HERE, "Search_MI_Dashboard.html")
    with io.open(out_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("\n  %s  (%.1f KB, %d product groups)"
          % (os.path.relpath(out_path, ROOT), len(html.encode("utf-8")) / 1024,
             len(data["products"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
