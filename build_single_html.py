#!/usr/bin/env python3
"""
Bundle the dashboard into ONE self-contained, timestamped .html file.

Inlines dashboard/styles.css, dashboard/data.js and dashboard/app.js into
dashboard/index.html and writes dist/TopMotive_Dashboard_YYYYMMDD_HHMM.html.
The only external reference left is the Google Fonts <link> (falls back to
Georgia/Segoe UI offline).
"""
import os, re, datetime, urllib.parse

HERE = os.path.dirname(__file__)
DASH = os.path.join(HERE, "dashboard")
DIST = os.path.join(HERE, "dist")


def read(name):
    with open(os.path.join(DASH, name), encoding="utf-8") as f:
        return f.read()


def main():
    html = read("index.html")
    css = read("styles.css")
    data_js = read("data.js")
    app_js = read("app.js")

    html = html.replace('<link rel="stylesheet" href="styles.css" />',
                        "<style>\n" + css + "\n</style>")

    # optional logo, inlined as a sized data-URI <img>
    svg_path = os.path.join(DASH, "zf-logo.svg")
    if os.path.exists(svg_path) and '<img id="zf-logo"' in html:
        logo = open(svg_path, encoding="utf-8").read()
        datauri = "data:image/svg+xml;utf8," + urllib.parse.quote(logo, safe="")
        html = re.sub(r'<img id="zf-logo".*?/>',
                      f'<img id="zf-logo" alt="ZF logo" src="{datauri}" />', html, flags=re.DOTALL)

    html = html.replace('<script src="data.js"></script>', "<script>\n" + data_js + "\n</script>")
    html = html.replace('<script src="app.js"></script>', "<script>\n" + app_js + "\n</script>")

    os.makedirs(DIST, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    out = os.path.join(DIST, f"TopMotive_Dashboard_{stamp}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Wrote {out}  ({os.path.getsize(out)/1024/1024:.2f} MB)")
    return out


if __name__ == "__main__":
    main()
