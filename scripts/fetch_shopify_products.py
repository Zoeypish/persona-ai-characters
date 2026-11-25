#!/usr/bin/env python3
"""Pull products from Shopify stores' public /products.json and write a Supabase import.

Polite by design: checks robots.txt, one request at a time, pauses between requests,
and stops after a few pages per store. Standard library only.

Usage: python3 scripts/fetch_shopify_products.py [--target 20] [--per-store 100]
Writes data/persona_products.csv, data/persona_products_import.sql, data/brands_report.json
"""
import csv, re, zlib, json, sys, time, urllib.request, urllib.robotparser, argparse, os
from datetime import datetime, timezone

# Candidate high-end / trendy brands believed to run on Shopify. Each one is verified at run time.
CANDIDATES = [
    ("Aimé Leon Dore", "www.aimeleondore.com"), ("Kith", "kith.com"), ("Fear of God", "fearofgod.com"),
    ("Cult Gaia", "cultgaia.com"), ("Staud", "staud.clothing"), ("Djerf Avenue", "djerfavenue.com"),
    ("House of Sunny", "houseofsunny.co.uk"), ("Réalisation Par", "realisationpar.com"),
    ("Rouje", "www.rouje.com"), ("Mirror Palais", "mirrorpalais.com"), ("Paloma Wool", "palomawool.com"),
    ("Sandy Liang", "sandyliang.info"), ("Bode", "bode.com"), ("Ulla Johnson", "ullajohnson.com"),
    ("LoveShackFancy", "www.loveshackfancy.com"), ("Mother Denim", "www.motherdenim.com"),
    ("Faithfull the Brand", "faithfullthebrand.com"), ("Represent", "representclo.com"),
    ("Khaite", "khaite.com"), ("Hanifa", "hanifa.co"), ("Collina Strada", "collinastrada.com"),
    ("Brain Dead", "wearebraindead.com"), ("Stüssy", "www.stussy.com"), ("Daily Paper", "www.dailypaperclothing.com"),
    ("Eckhaus Latta", "eckhauslatta.com"), ("Miaou", "miaou.com"), ("Frankies Bikinis", "frankiesbikinis.com"),
    ("Christopher Esber", "christopheresber.com.au"), ("Rotate", "rotate-birger-christensen.com"),
    ("Agolde", "agolde.com"), ("Bec + Bridge", "becandbridge.com.au"), ("Rachel Comey", "rachelcomey.com"),
    ("Jacquemus", "www.jacquemus.com"), ("Ganni", "www.ganni.com"), ("Nanushka", "www.nanushka.com"),
    ("Simon Miller", "simonmillerusa.com"), ("Dôen", "shopdoen.com"), ("With Jéan", "withjean.com"),
    ("Danielle Guizio", "danielleguizio.com"), ("Fanci Club", "fanciclub.com"),
]
# Pins on the site; each product is loosely linked to one of them (placeholder until visual matching).
PINS = [f"{c}-{i}" for c in ("lil-miquela", "imma", "aitana-lopez") for i in range(1, 7)]
UA = "Mozilla/5.0 (compatible; PersonaCatalogBot/0.1; product catalog sync)"
PAUSE = 1.5

def get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/plain,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")

def money(v):
    try:
        f = float(v)
        return round(f, 2) if f > 0 else None
    except (TypeError, ValueError):
        return None

def currency_for(domain):
    for path in ("/meta.json", "/cart.js"):
        try:
            d = json.loads(get(f"https://{domain}{path}"))
            if d.get("currency"):
                return d["currency"]
        except Exception:
            pass
        time.sleep(0.5)
    return None

def to_row(store, domain, p, currency, now):
    variants = p.get("variants") or []
    if not variants or not p.get("images"):
        return None
    avail = [v for v in variants if v.get("available")] or variants
    # The cheapest available variant decides the shown price.
    v = min(avail, key=lambda x: money(x.get("price")) or 1e9)
    cur, cmp = money(v.get("price")), money(v.get("compare_at_price"))
    if cur is None:
        return None
    on_sale = cmp is not None and cmp > cur
    sizes = []
    for x in variants:
        t = (x.get("option1") or x.get("title") or "").strip()
        if t and t.lower() != "default title" and t not in sizes:
            sizes.append(t)
    desc = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", p.get("body_html") or "")).strip()[:500] or None
    tags = p.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    return {
        "store": store, "store_domain": domain, "source": "shopify",
        "external_id": str(p["id"]), "title": (p.get("title") or "").strip(),
        "product_type": (p.get("product_type") or "").strip() or None,
        "tags": tags[:20],
        "price": cmp if on_sale else cur, "sale_price": cur if on_sale else None,
        "currency": currency, "link": f"https://{domain}/products/{p['handle']}",
        "image": p["images"][0].get("src"), "images": [i.get("src") for i in p["images"][:6]],
        "description": desc, "vendor": (p.get("vendor") or "").strip() or None, "sizes": sizes[:20],
        "published_at": p.get("published_at") or p.get("created_at"),
        "pin_ids": [PINS[zlib.crc32(str(p["id"]).encode()) % len(PINS)]],
        "available": any(x.get("available") for x in variants),
        "fetched_at": now,
    }

def fetch_store(store, domain, per_store, max_pages=2):
    report = {"store": store, "domain": domain}
    try:
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(get(f"https://{domain}/robots.txt").splitlines())
        if not rp.can_fetch(UA, f"https://{domain}/products.json"):
            report["status"] = "robots.txt disallows"; return report, []
    except Exception as e:
        report["robots"] = f"unreadable ({type(e).__name__})"
    time.sleep(PAUSE)
    products = []
    for page in range(1, max_pages + 1):
        try:
            data = json.loads(get(f"https://{domain}/products.json?limit=250&page={page}"))
        except Exception as e:
            if page == 1:
                report["status"] = f"no products.json ({type(e).__name__}: {str(e)[:80]})"; return report, []
            break
        batch = data.get("products") or []
        products += batch
        time.sleep(PAUSE)
        if len(batch) < 250:
            break
    if not products:
        report["status"] = "empty products.json"; return report, []
    currency = currency_for(domain)
    now = datetime.now(timezone.utc).isoformat()
    rows = [r for r in (to_row(store, domain, p, currency, now) for p in products) if r and r["available"]]
    rows.sort(key=lambda r: r["published_at"] or "", reverse=True)  # latest items first
    sale = [r for r in rows if r["sale_price"]]
    keep = rows[:per_store]
    report.update(status="ok", currency=currency, scanned=len(products), in_stock=len(rows),
                  on_sale=len(sale), kept=len(keep), kept_on_sale=sum(1 for r in keep if r["sale_price"]))
    return report, keep

def sql_str(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "array[" + ",".join(sql_str(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"

COLS = ["store", "store_domain", "source", "external_id", "title", "product_type", "tags",
        "price", "sale_price", "currency", "link", "image", "images", "description", "vendor", "sizes", "published_at", "pin_ids",
        "available", "fetched_at"]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=20)
    ap.add_argument("--per-store", type=int, default=100)
    ap.add_argument("--out", default="data")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    reports, all_rows = [], []
    for store, domain in CANDIDATES:
        if sum(1 for r in reports if r.get("status") == "ok") >= a.target:
            break
        rep, rows = fetch_store(store, domain, a.per_store)
        print(json.dumps(rep, ensure_ascii=False), flush=True)
        reports.append(rep); all_rows += rows
    with open(f"{a.out}/brands_report.json", "w") as f:
        json.dump(reports, f, indent=2, ensure_ascii=False)
    with open(f"{a.out}/persona_products.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(COLS)
        for r in all_rows:
            w.writerow(["{" + ",".join('"' + t.replace('"', '') + '"' for t in r[c]) + "}" if c in ("tags", "images", "sizes", "pin_ids")
                        else ("" if r[c] is None else r[c]) for c in COLS])
    with open(f"{a.out}/persona_products_import.sql", "w") as f:
        f.write("-- Generated by scripts/fetch_shopify_products.py. Run after the persona_products migration.\n")
        for i in range(0, len(all_rows), 200):
            chunk = all_rows[i:i + 200]
            f.write(f"insert into public.persona_products ({', '.join(COLS)}) values\n")
            f.write(",\n".join("(" + ", ".join(sql_str(r[c]) for c in COLS) + ")" for r in chunk))
            f.write("\non conflict (store_domain, external_id) do update set "
                    + ", ".join(f"{c} = excluded.{c}" for c in COLS if c not in ("store_domain", "external_id")) + ";\n\n")
    ok = [r for r in reports if r.get("status") == "ok"]
    print(f"\nBrands ok: {len(ok)}  items: {len(all_rows)}  on sale: {sum(1 for r in all_rows if r['sale_price'])}")

if __name__ == "__main__":
    main()
