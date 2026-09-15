# Basket Performance — TopMotive Project

Self-contained, offline dashboard over TopMotive catalog **basket demand**
(`QTY_POS` — how often a part from a TecDoc brand was placed in the basket with
intent to buy), for the ZF Group aftermarket brands.

## Files
```
dashboard/
  index.html    # dashboard shell (references styles.css, data.js, app.js)
  styles.css    # theme (Source Serif 4 + Segoe UI, navy/blue/teal)
  app.js        # all charts & interactivity (vanilla JS, no dependencies)
  data.js       # window.TM_DATA — the dataset (SOURCE OF TRUTH, committed)
build_single_html.py   # bundle dashboard/* into one timestamped dist/*.html
merge_new_data.py      # merge new quarterly genart CSVs into dashboard/data.js
data/raw/              # raw quarterly export CSVs added over time
```

## Build the shareable single file
```bash
python3 build_single_html.py      # -> dist/TopMotive_Dashboard_YYYYMMDD_HHMM.html
```
Open that file directly in a browser (works offline; ~0.5 MB, "lite" article
detail). The only external reference is Google Fonts (falls back to Georgia
offline).

## Add a new quarter / generic article
The dashboard is "lite": full brand-level facts for every genart/quarter, plus
the top ~120 articles per genart/quarter (with exact distinct-article counts).
`dashboard/data.js` is the canonical store.

1. Drop the new `dvse_BSK_DLNRGenart<N>...csv` (brand) and
   `dvse_BSK_DLNR_ArtNrGenart<N>...csv` (article) files into `data/raw/`.
2. Add a label for any new GENART code in `merge_new_data.py` (`NEW_GENART_LABELS`)
   and widen the genart filter in the merge script if needed.
3. `python3 merge_new_data.py` then `python3 build_single_html.py`.

> **Persistence note:** the earlier container was reclaimed and, because the
> repo could not be pushed from the locked-down laptop, the original raw history
> was lost. It was recovered by extracting `data.js` from the last delivered
> single-file HTML. **Keep `data.js` in git** — it is the historical record now.

## Definitions
- **Our brands (ZF Group):** Boge, Sachs, Lemförder, ZF, TRW, Gabriel, Girling
  (highlighted, marked ★). Matching is case/accent-insensitive.
- **Eigenmarken** (private-label aggregate, DLNR −1): counted in all totals,
  market & region demand, but excluded from brand/article rankings.
- **Markets (LKZ)** are the official ZF clusters; member countries come from the
  länder-cluster master file and are shown in tooltips / the Market Leadership
  definitions.

---

# Search & Market Indicator — TopMotive Project

A second, independent dashboard over the same TopMotive delivery, covering the
**search** side (article-number and vehicle searches) and the **Market
Indicator** (MI_TOP10) competitive ranking — as opposed to the basket-only view
above.

## Files
```
search_mi/
  build.py                  # regenerate the dashboard (this is the build)
  template.html             # shell: markup, CSS, charts; data goes in a placeholder
  data_legacy.json          # genart 82/273/402/854/914 — SOURCE OF TRUTH, committed
  Search_MI_Dashboard.html  # generated single-file dashboard (committed)
data/raw_search_mi/<genart>/ # raw quarterly exports for groups built from CSV
```

## Build
```bash
python3 search_mi/build.py     # -> search_mi/Search_MI_Dashboard.html
```
Open the file directly in a browser; it is fully offline apart from the Google
Fonts link (falls back to Georgia).

## Where the data comes from
Two sources are merged, and the split is deliberate:

- **Genart 82, 273, 402, 854, 914** come from `search_mi/data_legacy.json`. Their
  raw CSVs were lost with the original container (see the persistence note
  above), so that JSON *is* the record and `build.py` copies it through
  unchanged.
- **Genart 479, 1561, 4921** are derived from `data/raw_search_mi/<genart>/` on
  every build. Each folder holds one quarter's seven-file TopMotive export.

## Adding a product group or quarter
1. Drop the export folder's CSVs into `data/raw_search_mi/<genart>/`.
2. For a new group, add an entry to `NEW_PRODUCTS` in `search_mi/build.py`:
   `genart -> (label, supplier number, ZF brand)`. The `DS<n>` in the filenames
   *is* that supplier number (DS32 = SACHS, DS35 = LEMFÖRDER, DS68 = ZF).
3. `python3 search_mi/build.py`.

The period is read from the filename date range and cross-checked against
`LDATE` in the basket export, so a mislabelled folder fails the build rather
than landing in the wrong quarter.

## How each measure is derived
Per the definitions in *2025-04-29 TopMotive Concept* (Data Rules / Indicators):

| Measure | Derivation |
|---|---|
| `art_basket` / `art_cov` | `arc_artdir_gap_scoring` "Absolut" row: total `GENART_QTY_POS`, and the analysed ZF brand's covered share |
| `art_mi` | `art_cov / art_basket` |
| `veh_demand` / `veh_cov` | `arc_vehicle_gap_scoring` "Absolut" row: total `BSK_POS`, and the ZF brand's covered share |
| `veh_mi` | `veh_cov / veh_demand` |
| `combined_mi` | `(art_cov + veh_cov) / (art_basket + veh_demand)` — basket-weighted, not a plain average |
| `art_searches` | sum of `SUMMCNT` over the `ADS+` export |
| `art_found_searches` | `SUMMCNT` where **R1** is false, i.e. `SA200 = 1 OR SA203FF = 1` |
| `in1` | `SUMMCNT` where **R1** and `GENART_DLNR_QTY_POS > 0` (indicator IN1) |
| `oe` / `non_oe` | `SUMMCNT` split on `U4_OE` |
| `vbrand` / `vehicle` | vehicle gap rows joined to `KTypGap` for `KHER` / `KMOD`; demand `BSK_POS`, covered where the ZF column > 0 |
| `gap_veh` | vehicles with demand the ZF range does not serve (**R2**: `ART_CNT = 0`) |
| `gap_art` | searched numbers missing from the ZF range (**R1**), ranked by `SUMMCNT` |

`ART_CNT` in `KTypGap` was verified to equal the analysed brand's column in
`arc_vehicle_gap_scoring` for **every** KType in all three new groups, so R2 and
the gap-scoring column are the same signal.

### Cross-check
For all three groups built from raw CSVs, the derived `combined_mi` reproduces
the provider's own published MI_TOP10 score **exactly**: Clutch Kit / SACHS
87.76, Window Regulator / LEMFÖRDER 76.10, Oil Change Kit / ZF 73.77. That
pins the formula to the provider's method.

The same check on the legacy groups scatters between −1.2 and +3.5 pp, so those
five were built slightly differently. Their figures are left untouched — the raw
inputs no longer exist to rebuild them.

## Known data quirks
- The `arc_*` exports are ASCII with every non-ASCII character flattened to `?`
  (`LEMF?RDER`). `build.py` repairs them against the brand names in the UTF-8
  `dvse_BSK_DLNR` export.
- Genart 4921 has `U4_OE = 0` on every row, so its OE/non-OE split is 100 %
  non-OE. That is the delivered data, not a build error.
- The vehicle gap export carries a few hundred more KTypes than `KTypGap`. Those
  count toward `veh_demand` / `veh_cov` but cannot be labelled, so they are
  excluded from the per-manufacturer and per-model breakdowns.
- Product groups enter the programme at different quarters. 479 and 4921 are
  Q1 2026 only, 1561 is Q2 2026 only. Quarters with no delivery render as "—"
  with an explanatory banner, never as 0 %.
