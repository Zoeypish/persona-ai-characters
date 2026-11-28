// Persona search: one ranked search over characters (and their creators), images and brand products.
//
// Every item carries keywords in four groups, searched in this order of priority:
//   1. names    – character name, @handle, creator name / username      (most important)
//   2. styles   – streetwear, minimal, boho, y2k ...
//   3. item     – what it is and its colour: product title, "dress", "black", "denim" ...
//   4. brand    – Khaite, Kith, Stüssy ...
// A match in a higher group always beats one in a lower group. Exact words beat starts-of-words,
// which beat partial words, which beat near-misses (one typo).
(function () {
  var TIER = { name: 1000, style: 600, look: 520, item: 400, brand: 250 }; // look = style borrowed from the brand or character
  var STOP = { a: 1, an: 1, and: 1, the: 1, "in": 1, of: 1, "for": 1, "with": 1, by: 1, to: 1, on: 1, my: 1 };
  // Words people type -> the keyword we store.
  var SYN = {
    street: "streetwear", streetstyle: "streetwear", urban: "streetwear", hypebeast: "streetwear", skater: "skate",
    minimalist: "minimal", minimalism: "minimal", simple: "minimal", clean: "minimal", basic: "minimal",
    bohemian: "boho", hippie: "boho", romance: "romantic", girly: "feminine", femme: "feminine",
    sport: "sporty", athletic: "sporty", gym: "activewear", workout: "activewear", fitness: "activewear", athleisure: "athleisure",
    formal: "evening", gala: "evening", goingout: "party", nightout: "party", clubbing: "party", club: "party",
    work: "office", workwear: "office", business: "office", beachwear: "beach", vacation: "resort", holiday: "resort",
    retro: "vintage", thrift: "vintage", "2000s": "y2k", comfy: "cozy", cosy: "cozy", lounge: "cozy", loungewear: "cozy",
    luxe: "luxury", designer: "luxury", parisian: "french", colourful: "colorful", bright: "colorful",
    gray: "grey", colour: "color", tshirt: "tee", tees: "tee", jean: "jeans", trouser: "trousers", sneaker: "sneakers",
    trainers: "sneakers", purse: "bag", handbag: "bag", jewellery: "jewelry", swimsuit: "swim", bathing: "swim",
  };
  var STYLES = ["streetwear", "minimal", "boho", "romantic", "feminine", "chic", "classic", "preppy", "y2k", "party",
    "evening", "edgy", "vintage", "artsy", "cozy", "sporty", "athleisure", "resort", "beach", "luxury", "french", "denim",
    "colorful", "casual", "office", "skate", "floral", "playful"];

  function fold(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function stem(w) { return w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w; }
  function words(s) {
    return fold(s).replace(/[@#]/g, " ").replace(/(\w)[-'’.](?=\w)/g, "$1").split(/[^a-z0-9]+/).filter(Boolean);
  }
  // Query words: drop little words, map synonyms, singularise.
  function queryWords(q) {
    var joined = fold(q).replace(/\s+/g, "");
    if (SYN[joined]) return [SYN[joined]];
    return words(q).filter(function (w) { return !STOP[w]; }).map(function (w) { return stem(SYN[w] || w); });
  }
  function near(a, b) { // true if one typo apart (insert, delete or swap a letter)
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  // doc.f = { name: [...words], style: [...], item: [...], brand: [...] }, plus doc.full (for phrase matches)
  function makeDoc(type, ref, groups) {
    var f = {}, full = {};
    Object.keys(groups).forEach(function (g) {
      var list = [];
      (groups[g] || []).forEach(function (txt) { words(txt).forEach(function (w) { list.push(stem(w)); }); });
      f[g] = list; full[g] = (groups[g] || []).map(fold).join(" | ").replace(/[@#]/g, "");
    });
    return { type: type, ref: ref, f: f, full: full };
  }
  function scoreWord(doc, w) {
    var best = 0, best3 = 0;
    ["name", "style", "look", "item", "brand"].forEach(function (g) {
      var list = doc.f[g] || [], q = 0;
      for (var i = 0; i < list.length && q < 1; i++) {
        var t = list[i];
        if (t === w) q = 1;
        else if (w.length >= 2 && t.indexOf(w) === 0) q = Math.max(q, 0.8);
        else if (w.length >= 3 && t.indexOf(w) > 0) q = Math.max(q, 0.5);
        else if (w.length >= 5 && near(t, w)) q = Math.max(q, 0.4);
      }
      if (!q && w.length >= 4 && doc.full[g] && doc.full[g].replace(/[^a-z0-9]/g, "").indexOf(w) > -1) q = 0.5; // "noorvale" ~ "Noor Vale"
      var s = q * TIER[g];
      if (s > best) best = s;
      if (q === 1) best3 += TIER[g] * 0.02; // small bonus for matching in several groups
    });
    return best ? best + best3 : 0;
  }
  function scoreDoc(doc, qw, phrase) {
    var total = 0, hit = 0;
    qw.forEach(function (w) { var s = scoreWord(doc, w); if (s) { total += s; hit++; } });
    if (!hit) return 0;
    total += doc.boost || 0;
    if (hit < qw.length) total *= 0.25 * hit / qw.length; // every word should match; partial matches sink
    if (phrase.length > 3 && qw.length > 1) {
      if ((doc.full.name || "").indexOf(phrase) > -1) total += 800;
      else if ((doc.full.item || "").indexOf(phrase) > -1) total += 300;
    }
    return total;
  }

  // ---------- data ----------
  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) indexPromise = fetch("search-index.json").then(function (r) { return r.ok ? r.json() : { products: [], brands: {} }; })
      .catch(function () { return { products: [], brands: {} }; });
    return indexPromise;
  }
  function tags() { return window.SEARCH_TAGS || { characters: {}, pins: {} }; }
  function charDoc(c) {
    var styles = tags().characters[c.slug] || [];
    return makeDoc("character", c, {
      name: [c.name, c.handle, c.creator, c.creatorUsername || ""],
      style: styles,
      item: [c.category, c.origin, c.tagline].concat(c.knownFor || []),
      brand: [],
    });
  }
  // pins: from loadAllLive(); products: index products (to borrow words/brands of matched products)
  function pinDoc(p, byPin) {
    var c = charBySlug(p.slug) || {}, t = tags().pins[p.id] || {}, prods = byPin[p.id] || [];
    return makeDoc("pin", p, {
      name: [c.name, c.handle, c.creator, c.creatorUsername || ""],
      style: t.styles || [],
      look: tags().characters[p.slug] || [],
      item: (t.words || []).concat.apply(t.words || [], prods.map(function (x) { return x.w; })),
      brand: prods.map(function (x) { return x.b; }),
    });
  }
  function productDoc(x, brands) {
    var d = makeDoc("product", x, { name: [], style: x.s, look: x.w.indexOf("home") > -1 ? [] : brands[x.b] || [], item: [x.t].concat(x.w), brand: [x.b] });
    d.boost = (x.pins ? 30 : 0) - (x.w.length ? 0 : 120) - (x.w.indexOf("home") > -1 ? 200 : 0); // styled on a character: up; not clothing: down
    return d;
  }

  var cache = null;
  function buildAll(pinsBySlug) {
    return loadIndex().then(function (idx) {
      var byPin = {};
      idx.products.forEach(function (x) { (x.pins || []).forEach(function (id) { (byPin[id] = byPin[id] || []).push(x); }); });
      var pins = [];
      Object.keys(pinsBySlug || {}).forEach(function (s) { pins = pins.concat(pinsBySlug[s]); });
      cache = {
        idx: idx,
        chars: CHARACTERS.map(charDoc),
        pins: pins.map(function (p) { return pinDoc(p, byPin); }),
        products: (cache && cache.products) || idx.products.map(function (x) { return productDoc(x, idx.brands || {}); }),
        brands: Object.keys(idx.brands || {}),
      };
      return cache;
    });
  }

  // Among similar scores, don't show a wall of one brand: each repeat of a brand slides a little lower.
  function mixBrands(list) {
    var seen = {};
    return list.map(function (r) { var b = r.d.ref.b, n = seen[b] = (seen[b] || 0) + 1; return { d: r.d, s: r.s, m: r.s - (n - 1) * 12 }; })
      .sort(function (a, b) { return b.m - a.m; });
  }
  function run(all, q) {
    var qw = queryWords(q), phrase = fold(q).trim();
    function rank(list) {
      return list.map(function (d) { return { d: d, s: scoreDoc(d, qw, phrase) }; })
        .filter(function (r) { return r.s > 0; })
        .sort(function (a, b) { return b.s - a.s; });
    }
    if (!qw.length) return { q: q, words: [], chars: [], pins: [], products: [] };
    var chars = rank(all.chars), pins = rank(all.pins), products = mixBrands(rank(all.products));
    // When a name matches strongly, show that character's own images first, then the rest.
    return { q: q, words: qw, chars: chars, pins: pins, products: products,
      styles: STYLES.filter(function (s) { return qw.some(function (w) { return s.indexOf(w) === 0 || near(s, w); }); }),
      brands: all.brands.filter(function (b) { var fb = fold(b).replace(/[^a-z0-9]/g, ""); return qw.some(function (w) { return fb.indexOf(w) > -1; }); }) };
  }

  // ---------- suggestions under the header search box ----------
  function suggest(q) {
    var qw = queryWords(q), f = fold(q).replace(/^@/, "").trim();
    if (!f) return { chars: [], styles: STYLES.slice(0, 6), brands: [] };
    var chars = CHARACTERS.map(function (c) { return { c: c, s: scoreDoc(charDoc(c), qw, f) }; })
      .filter(function (r) { return r.s >= TIER.name * 0.5 || (r.s > 0 && f.length >= 3); })
      .sort(function (a, b) { return b.s - a.s; }).slice(0, 4).map(function (r) { return r.c; });
    var styles = STYLES.filter(function (s) { return qw.some(function (w) { return s.indexOf(w) === 0 || (w.length >= 5 && near(s, w)); }); }).slice(0, 4);
    var brands = ((cache && cache.brands) || []).filter(function (b) {
      var fb = fold(b); return qw.some(function (w) { return fb.split(/[^a-z0-9]+/).some(function (t) { return t.indexOf(w) === 0; }) || fb.replace(/[^a-z0-9]/g, "").indexOf(w) === 0; });
    }).slice(0, 3);
    return { chars: chars, styles: styles, brands: brands };
  }

  function wireHeader() {
    var form = document.getElementById("search-form"), input = document.getElementById("search");
    if (!form || !input) return;
    var params = new URLSearchParams(location.search);
    if (/search\.html$/.test(location.pathname) && params.get("q")) input.value = params.get("q");
    var box = document.createElement("div"); box.className = "suggest"; box.setAttribute("role", "listbox"); form.appendChild(box);
    var active = -1;
    function go(q) { q = String(q || "").trim(); if (q) location.href = "search.html?q=" + encodeURIComponent(q); }
    function draw() {
      var q = input.value, s = suggest(q), rows = [];
      s.chars.forEach(function (c) {
        rows.push('<a class="sg-row sg-char" href="profile.html?c=' + c.slug + '"><span class="mini-ava" data-ava="' + c.slug + '"></span>' +
          '<span><b>' + esc(c.name) + '</b><small>' + esc(c.handle || "") + (c.creator ? ' · by ' + esc(c.creator) : '') + '</small></span></a>');
      });
      if (s.styles.length) rows.push('<div class="sg-chips">' + s.styles.map(function (x) { return '<a class="sg-chip" href="search.html?q=' + encodeURIComponent(x) + '">' + esc(x) + '</a>'; }).join("") + '</div>');
      s.brands.forEach(function (b) { rows.push('<a class="sg-row" href="search.html?q=' + encodeURIComponent(b) + '"><span class="sg-ico">' + esc(b.charAt(0)) + '</span><span><b>' + esc(b) + '</b><small>Brand</small></span></a>'); });
      if (q.trim()) rows.push('<a class="sg-row sg-all" href="search.html?q=' + encodeURIComponent(q.trim()) + '"><span class="sg-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></span><span>Search “' + esc(q.trim()) + '”</span></a>');
      box.innerHTML = rows.join("");
      box.classList.toggle("open", rows.length > 0 && document.activeElement === input);
      active = -1;
      if (window.fillAvatars) fillAvatars(box);
    }
    input.setAttribute("autocomplete", "off");
    input.removeAttribute("list");
    input.addEventListener("focus", function () { loadIndex().then(function (idx) { if (!cache) cache = { brands: Object.keys(idx.brands || {}) }; draw(); }); draw(); });
    input.addEventListener("input", draw);
    input.addEventListener("blur", function () { setTimeout(function () { box.classList.remove("open"); }, 150); });
    input.addEventListener("keydown", function (e) {
      var items = box.querySelectorAll("a");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!items.length) return;
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items.forEach(function (a, i) { a.classList.toggle("on", i === active); });
      } else if (e.key === "Enter" && active > -1 && items[active]) { e.preventDefault(); location.href = items[active].href; }
      else if (e.key === "Escape") { box.classList.remove("open"); input.blur(); }
    });
    form.onsubmit = function (e) { e.preventDefault(); go(input.value); };
  }

  window.Search = { STYLES: STYLES, brandStyles: function (b) { return cache && cache.idx && cache.idx.brands[b]; }, loadIndex: loadIndex, buildAll: buildAll, run: run, suggest: suggest, queryWords: queryWords, fold: fold };
  wireHeader();
})();
