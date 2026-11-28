// Shared helpers. Images show a soft placeholder with the initial until they load.
function tileImg(img, name) {
  var initial = (name || "?").charAt(0);
  return '<img src="' + img.src + '" alt="' + img.alt + '" loading="lazy" onload="this.classList.add(\'loaded\')" ' +
    'onerror="this.style.display=\'none\'"><div class="ph">' + initial + '</div>';
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
  });
}

var MARK = '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="#fff" stroke="currentColor" stroke-width="4"/><path d="M32 3a29 29 0 0 0 0 58z" fill="currentColor"/></svg>';

// Light header: logo on the left, search and profile on the right.
(function header() {
  var el = document.getElementById("nav");
  if (!el) return;
  el.className = "nav";
  el.innerHTML =
    '<a class="wordmark" href="./" aria-label="Persona home">' + MARK + '<span>Persona</span></a>' +
    '<div class="nav-right">' +
      '<form class="search" role="search" id="search-form">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
        '<input id="search" type="search" placeholder="Search names, styles, brands" autocomplete="off" aria-label="Search">' +
      '</form>' +
      '<a class="nav-saved" href="saved.html" aria-label="Saved">' + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg><span>Saved</span></a>' +
      '<a class="nav-signin" id="nav-me" href="login.html">Sign in</a>' +
    '</div>';
  // Show who is actually signed in: their Google photo (or initials) linking to the Studio, otherwise "Sign in".
  if (window.Studio) Studio.session().then(function (u) {
    var me = document.getElementById("nav-me");
    if (!u || !me) return;
    var name = u.name || u.email || "";
    var initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("");
    me.className = "avatar"; me.href = "studio.html"; me.title = name; me.setAttribute("aria-label", "Your studio (" + name + ")");
    me.innerHTML = u.avatar ? '<img src="' + esc(u.avatar) + '" alt="" referrerpolicy="no-referrer">' : esc(initials || "?");
  }).catch(function () {});
  // Typing in the search box and its suggestions are handled in search.js.
})();

// ---------- Save, follow, shop ----------
var Social = (function () {
  var SAVED = "persona-saved-v1", FOLLOW = "persona-following-v1";
  function read(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  return {
    saved: function () { return read(SAVED); },
    isSaved: function (id) { return read(SAVED).some(function (p) { return p.id === id; }); },
    toggleSave: function (pin) {
      var list = read(SAVED), i = list.findIndex(function (p) { return p.id === pin.id; });
      if (i > -1) list.splice(i, 1); else list.unshift({ id: pin.id, slug: pin.slug, src: pin.src, alt: pin.alt, credit: pin.credit || "", creditUrl: pin.creditUrl || "" });
      write(SAVED, list); return i === -1;
    },
    following: function () { return read(FOLLOW); },
    isFollowing: function (slug) { return read(FOLLOW).indexOf(slug) > -1; },
    toggleFollow: function (slug) {
      var list = read(FOLLOW), i = list.indexOf(slug);
      if (i > -1) list.splice(i, 1); else list.push(slug);
      write(FOLLOW, list); return i === -1;
    },
  };
})();

function charBySlug(s) { return CHARACTERS.filter(function (c) { return c.slug === s; })[0]; }
function absUrl(src) { try { return new URL(src, location.href).href; } catch (e) { return src; } }
// Fallback for "Shop the look": a visual search for the products in the image.
function shopUrl(pin) {
  var c = charBySlug(pin.slug) || {};
  if (/^https?:/.test(absUrl(pin.src)) && !/^blob:/.test(pin.src) && !/localhost|127\.0\.0\.1/.test(location.host))
    return "https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(absUrl(pin.src));
  return "https://www.google.com/search?tbm=shop&q=" + encodeURIComponent((c.name || "") + " outfit");
}

var ICON = {
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function followBtn(slug, extra) {
  var on = Social.isFollowing(slug);
  return '<button class="follow-btn' + (on ? " on" : "") + (extra ? " " + extra : "") + '" data-follow="' + slug + '">' + (on ? "Following" : "Follow") + '</button>';
}

// pins: [{id, slug, src, alt, credit, creditUrl}]
// Image-first: each pin shows the whole image at its real shape (no cropping), with no caption underneath.
// The character's name only appears on top of the image, on hover.
var PINS = {};
function pinHtml(p, i) {
  PINS[p.id] = p;
  var c = charBySlug(p.slug) || { name: "" }, saved = Social.isSaved(p.id), ar = RATIO[p.src];
  return '<div class="pin" data-id="' + esc(p.id) + '">' +
    '<div class="pin-media' + (ar ? '' : ' r' + (i % 5)) + '" data-open="' + esc(p.id) + '"' + (ar ? ' style="aspect-ratio:1/' + ar.toFixed(4) + '"' : '') + '>' +
      '<img src="' + p.src + '" alt="' + esc(p.alt) + '" loading="lazy" decoding="async" onload="this.classList.add(\'loaded\')">' +
      '<div class="pin-over">' +
        '<button class="save-btn' + (saved ? " on" : "") + '" data-save="' + esc(p.id) + '">' + (saved ? "Saved" : "Save") + '</button>' +
        '<div class="pin-foot">' +
          '<a class="pin-who" href="profile.html?c=' + p.slug + '" data-stop><span class="mini-ava" data-ava="' + p.slug + '"></span>' + esc(c.name) + '</a>' +
          '<button class="shop-btn" data-shop="' + esc(p.id) + '" aria-label="Shop the look">' + ICON.bag + '</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// Real shape of each image (height / width), measured once so nothing gets cropped or zoomed.
var RATIO = {};
function measurePins(pins) {
  return Promise.all(pins.map(function (p) {
    if (RATIO[p.src]) return null;
    return new Promise(function (done) {
      var im = new Image(), t = setTimeout(fin, 4000);
      function fin() { clearTimeout(t); if (im.naturalWidth) RATIO[p.src] = im.naturalHeight / im.naturalWidth; done(); }
      im.onload = im.onerror = fin; im.src = p.src;
    });
  }));
}

function toPin(c, im) { return { id: im.id, slug: c.slug, src: im.src, alt: im.alt, credit: im.credit, creditUrl: im.creditUrl }; }

// Small round avatars use each character's first live image.
var AVATARS = {};
function fillAvatars(root) {
  (root || document).querySelectorAll("[data-ava]").forEach(function (el) {
    var src = AVATARS[el.dataset.ava];
    el.innerHTML = src ? '<img src="' + src + '" alt="">' : esc((charBySlug(el.dataset.ava) || { name: "?" }).name[0]);
  });
}

// One delegated handler for save / follow / open, on every page.
document.addEventListener("click", function (e) {
  var t = e.target.closest("[data-save],[data-follow],[data-open],[data-stop],[data-close],[data-shop]");
  if (!t) return;
  if (t.hasAttribute("data-stop")) { e.stopPropagation(); return; }
  if (t.hasAttribute("data-shop")) {
    e.preventDefault(); e.stopPropagation();
    if (!document.getElementById("closeup") || !document.getElementById("closeup").classList.contains("open")) openPin(t.dataset.shop);
    var list = document.getElementById("shop-list");
    if (list) list.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  if (t.hasAttribute("data-save")) {
    e.preventDefault(); e.stopPropagation();
    var on = Social.toggleSave(PINS[t.dataset.save]);
    document.querySelectorAll('[data-save="' + t.dataset.save + '"]').forEach(function (b) { b.classList.toggle("on", on); b.textContent = on ? "Saved" : "Save"; });
    document.dispatchEvent(new CustomEvent("persona:saved"));
    return;
  }
  if (t.hasAttribute("data-follow")) {
    e.preventDefault();
    var f = Social.toggleFollow(t.dataset.follow);
    document.querySelectorAll('[data-follow="' + t.dataset.follow + '"]').forEach(function (b) { b.classList.toggle("on", f); b.textContent = f ? "Following" : "Follow"; });
    document.dispatchEvent(new CustomEvent("persona:follow"));
    return;
  }
  if (t.hasAttribute("data-close")) { closePin(); return; }
  if (t.hasAttribute("data-open")) { openPin(t.dataset.open); }
});

// Pin closeup
function openPin(id) {
  var p = PINS[id]; if (!p) return;
  var c = charBySlug(p.slug) || { name: "", creator: "", slug: p.slug }, saved = Social.isSaved(p.id);
  var credit = p.creditUrl ? 'Image via <a href="' + p.creditUrl + '" target="_blank" rel="noopener">' + esc(p.credit) + '</a> · © ' + esc(c.creator) : (p.credit ? esc(p.credit) : "");
  var box = document.getElementById("closeup") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "closeup", className: "closeup" }));
  box.innerHTML =
    '<div class="closeup-card" role="dialog" aria-label="' + esc(c.name) + '">' +
      '<button class="closeup-x" data-close aria-label="Close">' + ICON.close + '</button>' +
      '<div class="closeup-img"><img src="' + p.src + '" alt="' + esc(p.alt) + '"></div>' +
      '<div class="closeup-side">' +
        '<div class="closeup-actions">' +
          '<button class="shop-btn big" data-shop="' + esc(p.id) + '">' + ICON.bag + 'Shop the look</button>' +
          '<button class="save-btn big' + (saved ? " on" : "") + '" data-save="' + esc(p.id) + '">' + (saved ? "Saved" : "Save") + '</button>' +
        '</div>' +
        '<div class="closeup-who"><a href="profile.html?c=' + c.slug + '" class="who"><span class="mini-ava lg" data-ava="' + c.slug + '"></span><span><b>' + esc(c.name) + '</b><small>by ' + esc(c.creator) + '</small></span></a>' + followBtn(c.slug) + '</div>' +
        (credit ? '<p class="closeup-credit">' + credit + '</p>' : '') +
        '<section class="shop-list" id="shop-list" aria-label="Shop the look"></section>' +
      '</div>' +
    '</div>';
  fillAvatars(box);
  renderShop(p);
  box.classList.add("open");
  document.body.style.overflow = "hidden";
}
// Products matched to this image. Falls back to a visual search when there are none (or no Supabase).
function money(n, cur) {
  if (n == null || n === "") return "";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch (e) { return "$" + n; }
}
function renderShop(p) {
  var el = document.getElementById("shop-list"); if (!el) return;
  var lens = '<a class="shop-more" href="' + shopUrl(p) + '" target="_blank" rel="noopener">More like this →</a>';
  el.innerHTML = '<h3>Shop the look</h3>';
  (window.Products ? Products.forPin(p.id) : Promise.resolve([])).then(function (items) {
    if (el !== document.getElementById("shop-list")) return;
    if (!items.length) { el.innerHTML = '<h3>Shop the look</h3>' + lens; return; }
    el.innerHTML = '<h3>Shop the look</h3>' +
      '<div class="shop-grid">' + items.map(function (it) {
        var price = it.on_sale
          ? '<b class="sale">' + money(it.sale_price, it.currency) + '</b> <s>' + money(it.price, it.currency) + '</s>'
          : '<b>' + money(it.price, it.currency) + '</b>';
        return '<a class="product" href="' + esc(it.link) + '" target="_blank" rel="noopener">' +
          '<span class="product-img" title="' + esc(it.title) + '">' + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '') + '</span>' +
          '<span class="product-price">' + price + '</span><small>' + esc(it.store) + '</small></a>';
      }).join("") + '</div>' + lens;
  });
}
function closePin() { var b = document.getElementById("closeup"); if (b) b.classList.remove("open"); document.body.style.overflow = ""; }
document.addEventListener("click", function (e) { if (e.target.id === "closeup") closePin(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePin(); });

// Load every character's live images once; pages render from this.
function loadAllLive() {
  return Studio.ready.then(function () {
    return Promise.all(CHARACTERS.map(function (c) { return Studio.liveFor(c); }));
  }).then(function (lists) {
    var out = {};
    lists.forEach(function (l, i) {
      var c = CHARACTERS[i]; out[c.slug] = l.map(function (im) { return toPin(c, im); });
      if (c.avatar) AVATARS[c.slug] = c.avatar; else if (l[0]) AVATARS[c.slug] = l[0].src;
    });
    return out;
  });
}

// ---------- Masonry with big images ----------
// Few, wide columns so every image is large. On the homepage no two pins from the same character
// touch (side by side or stacked). Pass {mixed:false} on single-character pages to skip that rule.
function colCount(w) { return w < 560 ? 1 : w < 900 ? 2 : Math.min(4, Math.max(2, Math.floor((w + 20) / (320 + 20)))); }
function layoutPins(el, pins, opts) {
  opts = opts || {};
  el._pins = pins; el._opts = opts;
  if (!el._resize) {
    el._resize = function () { var c2 = colCount(el.clientWidth); if (c2 !== el._cols) layoutPins(el, el._pins, el._opts); };
    window.addEventListener("resize", el._resize);
  }
  return measurePins(pins).then(function () { if (el._pins === pins) drawPins(el, pins, opts); });
}
function drawPins(el, pins, opts) {
  var mixed = opts.mixed !== false;
  var w = el.clientWidth || window.innerWidth, cols = colCount(w), gap = w < 900 ? 12 : 20;
  var colW = (w - gap * (cols - 1)) / cols, pad = 80 / colW, meta = gap / colW;
  var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  function ratio(p) { return RATIO[p.src] || 1.25; }
  function attempt(shuffle) {
    var pool = {}, order = [];
    pins.forEach(function (p) {
      var key = mixed ? p.slug : "all";
      (pool[key] = pool[key] || []).push(p);
      if (order.indexOf(key) < 0) order.push(key);
    });
    var col = [], total = 0; for (var k = 0; k < cols; k++) col.push({ h: 0, items: [] });
    function clash(slug, c, top, bot) {
      if (!mixed) return 0;
      var n = 0, me = col[c].items[col[c].items.length - 1];
      if (me && me.slug === slug) n += 20;                      // directly above
      [c - 1, c + 1].forEach(function (j) {
        if (j < 0 || j >= cols) return;
        col[j].items.forEach(function (it) {                    // side by side: real overlap 10, near miss 1
          if (it.slug !== slug) return;
          if (it.top < bot && it.bot > top) n += 10; else if (it.top < bot + pad && it.bot + pad > top) n += 1;
        });
      });
      return n;
    }
    for (var left = pins.length; left > 0; left--) {
      var c = 0; col.forEach(function (x, j) { if (x.h < col[c].h - 0.001) c = j; });
      var best = null;
      order.forEach(function (s) {
        var q = pool[s]; if (!q.length) return;
        var top = col[c].h, bot = top + ratio(q[0]) + meta, cl = clash(s, c, top, bot);
        var score = cl * 100 - q.length + (shuffle ? rnd() * 0.5 : 0);
        if (!best || score < best.score) best = { score: score, cl: cl, s: s, p: q[0], top: top, bot: bot };
      });
      pool[best.s].shift(); total += best.cl;
      col[c].items.push({ slug: best.p.slug, p: best.p, top: best.top, bot: best.bot });
      col[c].h = best.bot;
    }
    return { col: col, clashes: total };
  }
  var res = attempt(false);
  for (var t = 0; mixed && t < 1500 && res.clashes > 0; t++) { var r2 = attempt(true); if (r2.clashes < res.clashes) res = r2; }
  el._cols = cols;
  el.classList.add("pins-cols");
  el.style.setProperty("--cols", cols);
  el.innerHTML = res.col.map(function (x) {
    return '<div class="pcol">' + x.items.map(function (it, i) { return pinHtml(it.p, i); }).join("") + '</div>';
  }).join("");
  fillAvatars(el);
}
