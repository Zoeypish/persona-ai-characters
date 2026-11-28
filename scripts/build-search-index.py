#!/usr/bin/env python3
"""Build search-index.json: every brand product with its search keywords.

Usage:  python3 scripts/build-search-index.py path/to/persona_products.csv [supabase/shop-the-look-matches.sql]

Each product gets:
  styles  - style keywords (streetwear, minimal, boho, ...) from its own words (brand styles are in "brands")
  words   - what it is and its colour (dress, hoodie, black, denim, ...), incl. French names translated
The site's search ranks: character names/handles  >  styles  >  item names/words  >  brands.
Re-run this after the product list is refreshed.
"""
import csv, json, re, sys, unicodedata

# Every brand's overall look. A product also gets styles from its own words (below).
BRAND_STYLES = {
    "Aimé Leon Dore": ["streetwear", "preppy", "classic"],
    "Kith": ["streetwear", "sporty"],
    "Fear of God": ["streetwear", "minimal", "luxury"],
    "Represent": ["streetwear", "sporty"],
    "Brain Dead": ["streetwear", "artsy", "vintage"],
    "Stüssy": ["streetwear", "skate"],
    "Khaite": ["minimal", "luxury", "classic"],
    "Staud": ["minimal", "chic", "classic"],
    "Faithfull the Brand": ["resort", "boho", "feminine"],
    "Rouje": ["french", "romantic", "feminine", "chic"],
    "Mirror Palais": ["party", "feminine", "y2k"],
    "House of Sunny": ["y2k", "colorful", "playful"],
    "Hanifa": ["chic", "feminine", "evening"],
    "Paloma Wool": ["artsy", "minimal"],
    "Bode": ["vintage", "artsy", "preppy"],
    "Ulla Johnson": ["boho", "romantic", "feminine"],
    "LoveShackFancy": ["romantic", "feminine", "boho", "floral"],
    "Cult Gaia": ["resort", "party", "chic"],
    "Mother Denim": ["denim", "vintage", "casual"],
    "Collina Strada": ["artsy", "colorful", "playful"],
}

# word in a title/type -> what it is (first entry) and extra styles
ITEM_WORDS = [
    (r"\b(mini|midi|maxi)?\s*dress(es)?\b|\brobe\b|\bgown\b", ["dress"], []),
    (r"\bgown\b", ["gown"], ["evening", "party"]),
    (r"\bmini dress\b|\bmini\b", ["mini"], ["party"]),
    (r"\bmaxi\b", ["maxi"], ["boho"]),
    (r"\btank\b|\bcami(sole)?\b|\bdébardeur\b", ["tank", "top"], []),
    (r"\btee\b|\bt-shirt\b|\bt shirt\b|\btees\b", ["tee", "t-shirt", "top"], ["casual"]),
    (r"\btop\b|\btops\b|\bbody(suit)?\b|\bhaut\b|\bbustier\b|\bcorset\b", ["top"], []),
    (r"\bcorset\b|\bbustier\b", ["corset"], ["party"]),
    (r"\bblouse\b|\bchemise\b|\bshirt\b|\bbutton[ -]?(up|down)\b|\boxford\b", ["shirt"], []),
    (r"\bpolo\b|\brugby\b", ["polo", "shirt"], ["preppy"]),
    (r"\bsweater\b|\bjumper\b|\bpull\b|\bknit(s|wear)?\b|\bcrewneck\b|\bcashmere\b|\bmaille\b", ["sweater", "knit"], ["cozy"]),
    (r"\bcardigan\b|\bgilet\b", ["cardigan", "knit"], ["cozy"]),
    (r"\bhoodie\b|\bhooded\b|\bsweatshirt\b|\bcrew\b|\bsweat\b", ["hoodie", "sweatshirt"], ["streetwear", "cozy", "casual"]),
    (r"\bsweatpants?\b|\bjoggers?\b|\btrack ?pants?\b", ["sweatpants"], ["streetwear", "sporty", "cozy"]),
    (r"\bjacket\b|\bveste\b|\bbomber\b|\bvarsity\b|\bwindbreaker\b|\banorak\b", ["jacket", "outerwear"], []),
    (r"\bbomber\b|\bvarsity\b|\bwindbreaker\b|\btrack jacket\b", ["bomber"], ["streetwear", "sporty"]),
    (r"\bblazer\b|\bsuit\b|\btailor(ed)?\b", ["blazer"], ["classic", "office", "minimal"]),
    (r"\bcoat\b|\bmanteau\b|\btrench\b|\bovercoat\b|\bparka\b|\bpuffer\b|\bouterwear\b", ["coat", "outerwear"], []),
    (r"\bjeans?\b|\bdenim\b|\bjean\b", ["jeans", "denim"], ["denim", "casual"]),
    (r"\bpants?\b|\btrousers?\b|\bpantalon\b|\bslacks\b|\bchinos?\b|\bcargo\b", ["pants", "trousers"], []),
    (r"\bcargo\b", ["cargo"], ["streetwear"]),
    (r"\bshorts?\b|\bshort\b", ["shorts"], ["casual"]),
    (r"\bskirts?\b|\bjupe\b|\bpareo\b|\bsarong\b", ["skirt"], []),
    (r"\bbikini\b|\bswim\w*\b|\bmaillot\b|\bone[- ]piece\b", ["swim", "bikini", "swimwear"], ["beach", "resort"]),
    (r"\bset\b|\bco-?ord\b|\bmatching\b", ["set"], []),
    (r"\bjumpsuit\b|\bromper\b|\boveralls?\b|\bcombinaison\b|\bplaysuit\b", ["jumpsuit"], []),
    (r"\boveralls?\b|\bdungarees?\b", ["overalls"], ["casual", "vintage"]),
    (r"\blegging\w*\b|\bactive\b|\bsports? bra\b|\bbra top\b|\btraining\b|\bgym\b|\byoga\b", ["activewear"], ["sporty", "athleisure"]),
    (r"\bbag\b|\btote\b|\bclutch\b|\bpurse\b|\bhandbags?\b|\bsac\b|\bcrossbody\b|\bshoulder bag\b|\bbackpack\b|\bcarryall\b|\bpouch\b|\bwallet\b", ["bag"], []),
    (r"\bshoes?\b|\bfootwear\b|\bboots?\b|\bsneakers?\b|\btrainers?\b|\bsandals?\b|\bheels?\b|\bpumps?\b|\bloafers?\b|\bmules?\b|\bflats?\b|\bslides?\b|\bclogs?\b", ["shoes"], []),
    (r"\bboots?\b", ["boots"], []),
    (r"\bsneakers?\b|\btrainers?\b|\brunners?\b", ["sneakers"], ["streetwear", "sporty"]),
    (r"\bsandals?\b|\bslides?\b", ["sandals"], ["resort"]),
    (r"\bheels?\b|\bpumps?\b|\bstiletto\b", ["heels"], ["party"]),
    (r"\bhats?\b|\bcap\b|\bbeanie\b|\bbucket\b|\bheadwear\b|\bbandana\b", ["hat"], []),
    (r"\bcap\b|\bbeanie\b|\bbucket\b|\btrucker\b", ["cap"], ["streetwear"]),
    (r"\brings?\b|\bearrings?\b|\bnecklace\b|\bbracelet\b|\bjewel\w*\b|\bpendant\b|\bchain\b|\bhoops?\b|\bbangle\b|\bcharm\b", ["jewelry"], []),
    (r"\bearrings?\b|\bhoops?\b", ["earrings"], []),
    (r"\bnecklace\b|\bpendant\b|\bchain\b", ["necklace"], []),
    (r"\bsunglasses\b|\bglasses\b|\beyewear\b", ["sunglasses"], []),
    (r"\bscarf\b|\bfoulard\b|\bbelt\b|\bceinture\b|\bsocks?\b|\bgloves?\b|\baccessor\w*\b|\bkeychain\b|\bhair\b|\bscrunchie\b|\bheadband\b", ["accessories"], []),
    (r"\bpillow\b|\bsham\b|\bcandle\b|\bmug\b|\bdecor\b|\bblanket\b|\bbedding\b|\btowel\b|\bplate\b|\bvase\b|\bwrapping paper\b|\bbook\b|\bposter\b", ["home"], []),
]

# words anywhere in a title/tags -> extra styles
STYLE_WORDS = [
    (r"\bfloral\b|\bflower\b|\brose\b|\bblossom\b|\bditsy\b", ["floral", "romantic"]),
    (r"\blace\b|\bdentelle\b|\bruffle\w*\b|\bbow\b|\bpuff\b|\bsmock\w*\b|\beyelet\b|\bbroderie\b", ["romantic", "feminine"]),
    (r"\bcrochet\b|\bfringe\b|\bpaisley\b|\bpeasant\b|\btiered\b|\bpatchwork\b|\bmacrame\b|\bkaftan\b|\bprairie\b", ["boho"]),
    (r"\blinen\b|\blin\b|\bcotton gauze\b|\bresort\b|\bvacation\b|\bbeach\b|\bkaftan\b|\bcaftan\b", ["resort", "summer"]),
    (r"\bsequin\w*\b|\bsatin\b|\bsilk\b|\bsoie\b|\bvelvet\b|\bmetallic\b|\bsparkl\w*\b|\bstrapless\b|\bslip\b|\bcutout\b|\bcut-out\b|\bsheer\b|\bmesh\b", ["party", "evening"]),
    (r"\bgraphic\b|\blogo\b|\bprint(ed)?\b.*\btee\b|\bbox logo\b|\boversized\b|\bbaggy\b|\bwide leg\b.*\bjean", ["streetwear"]),
    (r"\bleather\b|\bcuir\b|\bstud\w*\b|\bbiker\b|\bmoto\b|\bcroco\w*\b|\bpatent\b", ["edgy"]),
    (r"\bvintage\b|\bwashed\b|\bfaded\b|\bdistressed\b|\bretro\b|\bfade\b", ["vintage"]),
    (r"\bstripe\w*\b|\bcable\b|\bvarsity\b|\bplaid\b|\btartan\b|\bargyle\b|\bpleat\w*\b|\boxford\b|\bloafer\w*\b|\bpolo\b", ["preppy"]),
    (r"\bcashmere\b|\bwool\b|\bmerino\b|\bfleece\b|\bsherpa\b|\bteddy\b|\bknit\b|\blounge\b", ["cozy"]),
    (r"\bmini\b|\bmicro\b|\blow[- ]rise\b|\bbaby tee\b|\bbutterfly\b|\bhalter\b|\bshrunken\b", ["y2k"]),
    (r"\bneon\b|\brainbow\b|\btie[- ]dye\b|\bmulticolou?r\b|\bcolorful\b", ["colorful"]),
    (r"\btailor\w*\b|\bpleated trouser\b|\bshirt dress\b|\bwool trouser\b|\bclean\b|\bessential\b|\bbasic\b", ["minimal"]),
]

# colours: canonical name -> words that mean it (English + French + shop names)
COLOURS = {
    "black": r"black|noir|jet|onyx|ebony|espresso black|night",
    "white": r"white|blanc|ivory|chalk|cream|ecru|off[- ]white|optic|pearl|bone|vanilla|milk",
    "grey": r"grey|gray|gris|charcoal|heather|ash|slate|silver|smoke",
    "beige": r"beige|tan|camel|sand|oat\w*|khaki|taupe|stone|nude|natural|biscuit|latte",
    "brown": r"brown|marron|chocolate|espresso|mocha|cognac|coffee|chestnut|tobacco|caramel|rust",
    "pink": r"pink|rose|blush|fuchsia|magenta|azalea|peony|bubblegum|rosa",
    "red": r"red|rouge|cherry|crimson|scarlet|burgundy|wine|bordeaux|ruby|oxblood|merlot",
    "orange": r"orange|tangerine|coral|apricot|peach|terracotta|amber",
    "yellow": r"yellow|jaune|lemon|butter|mustard|gold|honey|sunflower",
    "green": r"green|vert|olive|sage|mint|forest|emerald|moss|lime|pistachio|army|jade|kelly",
    "blue": r"blue|bleu|navy|cobalt|azure|sky|indigo|denim|teal|aqua|turquoise|cerulean|marine|chambray",
    "purple": r"purple|violet|lilac|lavender|plum|mauve|grape|orchid|aubergine|eggplant",
    "multicolor": r"multi\w*|print|floral|stripe|plaid|check",
}

TAG_COLOUR = re.compile(r"(?:filter_colou?r|colou?r|colorgroup|colourfamily|regroupement_couleur)[:_\-\s]+([a-z ]+)", re.I)


def fold(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return s.lower()


def tag_list(raw):
    return re.findall(r'"([^"]+)"', raw or "") or [t for t in (raw or "").strip("{}").split(",") if t]


def keywords(row):
    title, ptype = row["title"], row["product_type"]
    text = fold(title + " | " + ptype)
    tags = tag_list(row["tags"])
    words, styles = [], []
    for pat, what, st in ITEM_WORDS:
        if re.search(pat, text):
            words += what; styles += st
    for pat, st in STYLE_WORDS:
        if re.search(pat, text):  # shop tags are too noisy for styles; colours still use them
            styles += st
    # colour: from the title first, then shop colour tags
    coltext = text + " " + " ".join(fold(m.group(1)) for t in tags for m in [TAG_COLOUR.search(t)] if m)
    for name, pat in COLOURS.items():
        if re.search(r"\b(" + pat + r")\b", coltext):
            words.append(name)
    if "home" in words:  # pillows, candles etc. are not outfits
        styles = [s for s in styles if s in ("floral", "colorful", "romantic")]
    dedup = lambda xs: list(dict.fromkeys(xs))
    # "s" holds only the product's own styles; the brand's styles are added by the site (ranked a little lower).
    return [x for x in dedup(styles) if x not in BRAND_STYLES.get(row["store"], [])], dedup(words)


def matches(sql_path):
    """(domain, external_id) -> [pin ids] from the shop-the-look SQL."""
    out = {}
    if not sql_path:
        return out
    for dom, ext, pins in re.findall(r"\('([^']+)',\s*'([^']+)',\s*array\[([^\]]*)\]", open(sql_path, encoding="utf-8").read()):
        out[(dom, ext)] = re.findall(r"'([^']+)'", pins)
    return out


def thumb(url):
    if not url:
        return ""
    url = re.sub(r"([?&])v=\d+", r"\1", url).rstrip("?&")
    return url + ("&" if "?" in url else "?") + "width=500"


def num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 2)
    except (TypeError, ValueError):
        return None


def main():
    csv_path = sys.argv[1]
    sql_path = sys.argv[2] if len(sys.argv) > 2 else "supabase/shop-the-look-matches.sql"
    pins = matches(sql_path)
    items = []
    for row in csv.DictReader(open(csv_path, encoding="utf-8")):
        if str(row.get("available", "true")).lower() in ("false", "f", "0"):
            continue
        if re.search(r"\btest\b|gift card", row["title"], re.I):
            continue
        styles, words = keywords(row)
        price, sale = num(row["price"]), num(row["sale_price"])
        item = {
            "id": row["store_domain"] + ":" + row["external_id"],
            "t": row["title"].strip(),
            "b": row["store"],
            "p": price,
            "l": row["link"],
            "m": thumb(row["image"]),
            "s": styles,
            "w": words,
        }
        if sale and price and sale < price:
            item["sp"] = sale
        if row["currency"] and row["currency"] != "USD":
            item["c"] = row["currency"]
        pin = pins.get((row["store_domain"], row["external_id"]))
        if pin:
            item["pins"] = pin
        items.append(item)
    out = {"brands": BRAND_STYLES, "products": items}
    with open("search-index.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(len(items), "products written to search-index.json;", sum(1 for i in items if i.get("pins")), "linked to images")


if __name__ == "__main__":
    main()
