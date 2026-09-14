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
