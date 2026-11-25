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
        '<input id="search" type="search" placeholder="Search characters, looks, creators" list="search-list" autocomplete="off" aria-label="Search characters">' +
        '<datalist id="search-list"></datalist>' +
      '</form>' +
      '<a class="nav-saved" href="saved.html" aria-label="Saved">' + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg><span>Saved</span></a>' +
      '<a class="avatar" href="studio.html" title="' + esc(CREATOR.name) + '" aria-label="Your profile and studio">' +
        esc(CREATOR.name.split(" ").map(function (w) { return w[0]; }).join("")) + '</a>' +
    '</div>';
  window.PersonaReady.then(function () {
    document.getElementById("search-list").innerHTML = CHARACTERS.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join("");
  });
  document.getElementById("search-form").onsubmit = function (e) {
    e.preventDefault();
    var q = document.getElementById("search").value.trim().toLowerCase();
    if (!q) return;
    var hit = CHARACTERS.filter(function (c) {
      return (c.name + " " + c.handle + " " + c.category + " " + c.origin + " " + c.creator).toLowerCase().indexOf(q) > -1;
    })[0];
    if (hit) location.href = "profile.html?c=" + hit.slug;
    else document.getElementById("search").value = "", document.getElementById("search").placeholder = "No match for “" + q + "”";
  };
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
// "Shop the look": visual search for the products in the image.
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
var PINS = {};
function pinHtml(p, i) {
  PINS[p.id] = p;
  var c = charBySlug(p.slug) || { name: "" }, saved = Social.isSaved(p.id);
  return '<div class="pin" data-id="' + esc(p.id) + '">' +
    '<div class="pin-media r' + (i % 5) + '" data-open="' + esc(p.id) + '">' +
      '<img src="' + p.src + '" alt="' + esc(p.alt) + '" loading="lazy" onload="this.classList.add(\'loaded\')">' +
      '<div class="pin-over">' +
        '<button class="save-btn' + (saved ? " on" : "") + '" data-save="' + esc(p.id) + '">' + (saved ? "Saved" : "Save") + '</button>' +
        '<a class="shop-btn" href="' + shopUrl(p) + '" target="_blank" rel="noopener" data-stop>' + ICON.bag + 'Shop</a>' +
      '</div>' +
    '</div>' +
    '<a class="pin-meta" href="profile.html?c=' + p.slug + '"><span class="mini-ava" data-ava="' + p.slug + '"></span>' + esc(c.name) + '</a>' +
  '</div>';
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
  var t = e.target.closest("[data-save],[data-follow],[data-open],[data-stop],[data-close]");
  if (!t) return;
  if (t.hasAttribute("data-stop")) { e.stopPropagation(); return; }
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
          '<a class="shop-btn big" href="' + shopUrl(p) + '" target="_blank" rel="noopener">' + ICON.bag + 'Shop the look</a>' +
          '<button class="save-btn big' + (saved ? " on" : "") + '" data-save="' + esc(p.id) + '">' + (saved ? "Saved" : "Save") + '</button>' +
        '</div>' +
        '<div class="eyebrow">' + esc(c.category) + '</div>' +
        '<h2>' + esc(c.name) + '</h2>' +
        '<p class="closeup-tag">' + esc(c.tagline) + '</p>' +
        '<div class="closeup-who"><a href="profile.html?c=' + c.slug + '" class="who"><span class="mini-ava lg" data-ava="' + c.slug + '"></span><span><b>' + esc(c.name) + '</b><small>by ' + esc(c.creator) + '</small></span></a>' + followBtn(c.slug) + '</div>' +
        (credit ? '<p class="closeup-credit">' + credit + '</p>' : '') +
        '<a class="ulink closeup-more" href="profile.html?c=' + c.slug + '">See all of ' + esc(c.name) + ' →</a>' +
      '</div>' +
    '</div>';
  fillAvatars(box);
  box.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closePin() { var b = document.getElementById("closeup"); if (b) b.classList.remove("open"); document.body.style.overflow = ""; }
document.addEventListener("click", function (e) { if (e.target.id === "closeup") closePin(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePin(); });

// Load every character's live images once; pages render from this.
function loadAllLive() {
  return window.PersonaReady.then(function () { return Promise.all(CHARACTERS.map(function (c) { return Studio.liveFor(c); })); }).then(function (lists) {
    var out = {};
    lists.forEach(function (l, i) { var c = CHARACTERS[i]; out[c.slug] = l.map(function (im) { return toPin(c, im); }); if (l[0]) AVATARS[c.slug] = l[0].src; });
    return out;
  });
}

// ---------- Mixed masonry: no two pins from the same character touch ----------
// Builds explicit columns so we control neighbours both above/below and side by side.
var RATIOS = [1.5, 4 / 3, 1.25, 16 / 9, 1]; // height / width for r0..r4
function layoutPins(el, pins) {
  var w = el.clientWidth || window.innerWidth, gap = w < 820 ? 10 : 16;
  var cols = w < 820 ? 2 : Math.min(6, Math.max(2, Math.floor((w + gap) / (220 + gap))));
  var colW = (w - gap * (cols - 1)) / cols, pad = 80 / colW, meta = (w < 820 ? 50 : 56) / colW; // caption + bottom margin
  var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  function attempt(shuffle) {
    var pool = {}, order = [];
    pins.forEach(function (p, i) {
      var r = shuffle ? Math.floor(rnd() * 5) : i % 5;
      (pool[p.slug] = pool[p.slug] || []).push({ p: p, r: r });
      if (order.indexOf(p.slug) < 0) order.push(p.slug);
    });
    var col = [], total = 0; for (var k = 0; k < cols; k++) col.push({ h: 0, items: [] });
    function clash(slug, c, top, bot) {
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
        var top = col[c].h, bot = top + RATIOS[q[0].r] + meta, cl = clash(s, c, top, bot);
        var score = cl * 100 - q.length + (shuffle ? rnd() * 0.5 : 0);
        if (!best || score < best.score) best = { score: score, cl: cl, s: s, it: q[0], top: top, bot: bot };
      });
      pool[best.s].shift(); total += best.cl;
      col[c].items.push({ slug: best.s, p: Object.assign({}, best.it.p, { _r: best.it.r }), top: best.top, bot: best.bot });
      col[c].h = best.bot;
    }
    return { col: col, clashes: total };
  }
  var res = attempt(false);
  for (var t = 0; t < 1500 && res.clashes > 0; t++) { var r2 = attempt(true); if (r2.clashes < res.clashes) res = r2; }
  var col = res.col;
  el.classList.add("pins-cols");
  el.style.setProperty("--cols", cols);
  el.innerHTML = col.map(function (x) {
    return '<div class="pcol">' + x.items.map(function (it) { return pinHtml(it.p, it.p._r); }).join("") + '</div>';
  }).join("");
  fillAvatars(el);
  if (!el._resize) {
    var last = cols;
    el._resize = function () {
      var w2 = el.clientWidth, c2 = w2 < 820 ? 2 : Math.min(6, Math.max(2, Math.floor((w2 + 16) / 236)));
      if (c2 !== last) { last = c2; layoutPins(el, el._pins); }
    };
    window.addEventListener("resize", el._resize);
  }
  el._pins = pins;
}
