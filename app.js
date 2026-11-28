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
// Saves and follows live in this browser for visitors. For signed-in people they are also stored in their
// Persona account (Supabase tables "saves" and "follows"), so they follow them to any device.
// On sign-in, anything saved in this browser before signing in is added to the account.
var Social = (function () {
  var SAVED = "persona-saved-v1", FOLLOW = "persona-following-v1", OWNER = "persona-social-owner-v1";
  var uid = null; // signed-in account whose saves are in sync, or null
  function read(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function db() { return uid && window.Studio && Studio.client; }
  function warn(r) { if (r && r.error) console.warn("Couldn't sync to your account:", r.error.message); }
  function snap(pin) { return { id: pin.id, slug: pin.slug, src: pin.src, alt: pin.alt, credit: pin.credit || "", creditUrl: pin.creditUrl || "" }; }

  // Called once per page: load the account's saves and follows, and add this browser's to the account.
  function sync() {
    if (!window.Studio || !Studio.client) return Promise.resolve(false);
    return Studio.session().then(function (u) {
      if (!u) {
        // Signed out (e.g. on another tab): don't keep the last person's saves on this device.
        if (localStorage.getItem(OWNER)) { [SAVED, FOLLOW, OWNER].forEach(function (k) { localStorage.removeItem(k); }); return true; }
        return false;
      }
      var sb = Studio.client;
      return Promise.all([
        sb.from("saves").select("pin_id,pin,created_at").order("created_at", { ascending: false }),
        sb.from("follows").select("character_slug,created_at").order("created_at"),
      ]).then(function (r) {
        if (r[0].error || r[1].error) { warn(r[0].error ? r[0] : r[1]); return false; } // tables not set up yet: stay in this browser
        var owner = localStorage.getItem(OWNER);
        // Saves made in this browser by a visitor (or by this same account) are kept; another account's are not.
        var localSaves = owner && owner !== u.id ? [] : read(SAVED), localFollows = owner && owner !== u.id ? [] : read(FOLLOW);
        var have = {}, saves = r[0].data.map(function (x) { have[x.pin_id] = 1; return Object.assign({}, x.pin, { id: x.pin_id }); });
        var newSaves = localSaves.filter(function (p) { return p && p.id && !have[p.id]; });
        var follows = r[1].data.map(function (x) { return x.character_slug; });
        var newFollows = localFollows.filter(function (s) { return follows.indexOf(s) < 0; });
        uid = u.id;
        var ups = [];
        if (newSaves.length) ups.push(sb.from("saves").upsert(newSaves.slice().reverse().map(function (p) { return { pin_id: p.id, pin: snap(p) }; }), { onConflict: "user_id,pin_id" }).then(warn));
        if (newFollows.length) ups.push(sb.from("follows").upsert(newFollows.map(function (s) { return { character_slug: s }; }), { onConflict: "user_id,character_slug" }).then(warn));
        var before = JSON.stringify([read(SAVED), read(FOLLOW)]);
        write(SAVED, newSaves.concat(saves)); write(FOLLOW, follows.concat(newFollows));
        try { localStorage.setItem(OWNER, u.id); } catch (e) {}
        return Promise.all(ups).then(function () { return before !== JSON.stringify([read(SAVED), read(FOLLOW)]); });
      });
    }).catch(function (e) { console.warn("Couldn't load your saves:", e); return false; });
  }

  var api = {
    saved: function () { return read(SAVED); },
    isSaved: function (id) { return read(SAVED).some(function (p) { return p.id === id; }); },
    toggleSave: function (pin) {
      var list = read(SAVED), i = list.findIndex(function (p) { return p.id === pin.id; });
      if (i > -1) list.splice(i, 1); else list.unshift(snap(pin));
      write(SAVED, list);
      if (db()) (i > -1 ? Studio.client.from("saves").delete().eq("pin_id", pin.id)
                        : Studio.client.from("saves").upsert({ pin_id: pin.id, pin: snap(pin) }, { onConflict: "user_id,pin_id" })).then(warn);
      return i === -1;
    },
    following: function () { return read(FOLLOW); },
    isFollowing: function (slug) { return read(FOLLOW).indexOf(slug) > -1; },
    toggleFollow: function (slug) {
      var list = read(FOLLOW), i = list.indexOf(slug);
      if (i > -1) list.splice(i, 1); else list.push(slug);
      write(FOLLOW, list);
      if (db()) (i > -1 ? Studio.client.from("follows").delete().eq("character_slug", slug)
                        : Studio.client.from("follows").upsert({ character_slug: slug }, { onConflict: "user_id,character_slug" })).then(warn);
      return i === -1;
    },
    // Forget this device's copy (used on sign-out). The account keeps everything.
    clearLocal: function () { [SAVED, FOLLOW, OWNER].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} }); uid = null; },
    inAccount: function () { return !!uid; },
  };
  // Pages wait for this (via loadAllLive) so the homepage mix uses the account's follows.
  api.ready = (window.Studio ? Studio.ready : Promise.resolve()).then(sync).then(function (changed) {
    if (!changed) return;
    // Update any Save / Follow buttons already on screen, then let pages re-render.
    document.querySelectorAll("[data-save]").forEach(function (b) { var on = api.isSaved(b.dataset.save); b.classList.toggle("on", on); b.textContent = on ? "Saved" : "Save"; });
    document.querySelectorAll("[data-follow]").forEach(function (b) { var on = api.isFollowing(b.dataset.follow); b.classList.toggle("on", on); b.textContent = on ? "Following" : "Follow"; });
    document.dispatchEvent(new CustomEvent("persona:saved")); document.dispatchEvent(new CustomEvent("persona:follow"));
  }, function () {});
  return api;
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
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>',
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
      '<span class="ai-tag" title="AI-generated image of a virtual character">AI</span>' +
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

function toPin(c, im) { return { id: im.id, slug: c.slug, src: im.src, alt: im.alt, credit: im.credit, creditUrl: im.creditUrl, created: im.created, uploaded: !!im.uploaded, origin: im.origin }; }

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
        originHtml(p, c) +
        '<section class="shop-list" id="shop-list" aria-label="Shop the look"></section>' +
        '<div class="report-wrap" id="report-wrap"><button class="linkbtn report-link" data-report="' + esc(p.id) + '">' + ICON.flag + 'Report this image</button></div>' +
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
        // Prices are shown in US dollars (converted from the store's currency, updated daily).
        var full = it.price_usd != null ? it.price_usd : it.price, sale = it.sale_price_usd != null ? it.sale_price_usd : it.sale_price;
        var cur = it.price_usd != null ? "USD" : it.currency;
        var price = it.on_sale && sale != null
          ? '<b class="sale">' + money(sale, cur) + '</b> <s>' + money(full, cur) + '</s>'
          : '<b>' + money(full, cur) + '</b>';
        // Every click goes through /api/go, which tracks it and uses the best-paying affiliate link.
        var href = "/api/go?p=" + encodeURIComponent(it.id) + "&pin=" + encodeURIComponent(p.id) + "&c=" + encodeURIComponent(p.slug);
        return '<a class="product" href="' + esc(href) + '" target="_blank" rel="noopener sponsored">' +
          '<span class="product-img" title="' + esc(it.title) + '">' + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '') + '</span>' +
          '<span class="product-price">' + price + '</span><small>' + esc(it.store) + '</small></a>';
      }).join("") + '</div>' + lens;
  });
}
// ---------- AI label and origin record (provenance) ----------
// Every image on Persona is of a virtual character. The origin record says who made it, with what, when, and how.
function originHtml(p, c) {
  var o = p.origin || {}, when = p.created ? new Date(p.created).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  var rows = [
    ["Made by", esc(c.creator || "The character's creator")],
    ["Character", esc(c.name) + " (virtual, not a real person)"],
    ["AI tool", o.tool ? esc(o.tool) : "Not shared by the creator"],
    ["Added", when || (p.uploaded ? "" : "Before Persona (featured)")],
    ["Source", p.creditUrl ? '<a href="' + esc(p.creditUrl) + '" target="_blank" rel="noopener">' + esc(p.credit || "Original post") + '</a>' : (o.source ? esc(o.source) : (p.uploaded ? "Uploaded to Persona" : ""))],
    ["Rights", p.uploaded ? "Creator confirmed they own this image" : "Shown with credit to the creator"],
  ].filter(function (r) { return r[1]; });
  return '<details class="origin">' +
    '<summary><span class="ai-badge">AI-generated</span><span class="origin-sum">Origin record</span></summary>' +
    '<dl>' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join("") + '</dl>' +
    (o.recipe ? '<div class="recipe"><b>Prompt / recipe</b><p>' + esc(o.recipe) + '</p><button class="linkbtn" data-copy-recipe>Copy</button></div>' : '') +
  '</details>';
}

// ---------- Report an image ----------
var REPORT_REASONS = [
  ["real_person", "Shows a real person without their consent"],
  ["copyright", "Uses my work or someone else's without permission"],
  ["sexual", "Sexual or nude content"],
  ["minor", "Looks like a child in an unsafe way"],
  ["hate", "Hate or harassment"],
  ["violence", "Violence or self-harm"],
  ["spam", "Spam or a scam"],
  ["other", "Something else"],
];
function openReport(id) {
  var p = PINS[id], wrap = document.getElementById("report-wrap"); if (!p || !wrap) return;
  Studio.session().then(function (u) {
    if (!u) {
      wrap.innerHTML = '<div class="report-box"><b>Report this image</b><p>Please <a href="login.html">sign in</a> to report, so one person can\'t hide images on their own. ' +
        'If it\'s your image or your face, you can also send a <a href="takedown.html?image=' + encodeURIComponent(p.id) + '&c=' + encodeURIComponent(p.slug) + '">takedown request</a> without signing in.</p></div>';
      return;
    }
    wrap.innerHTML = '<form class="report-box" id="report-form"><b>What\'s wrong with this image?</b>' +
      REPORT_REASONS.map(function (r, i) { return '<label><input type="radio" name="reason" value="' + r[0] + '"' + (i ? '' : ' required') + '> ' + r[1] + '</label>'; }).join("") +
      '<textarea name="details" rows="2" maxlength="2000" placeholder="Anything else we should know? (optional)"></textarea>' +
      '<div class="report-row"><button class="btn" type="submit">Send report</button><button class="linkbtn" type="button" data-report-cancel>Cancel</button></div>' +
      '<p class="muted">Reports are private. An image reported by 3 people is hidden until we review it. ' +
      '<a href="takedown.html?image=' + encodeURIComponent(p.id) + '&c=' + encodeURIComponent(p.slug) + '">Own this image? Request a takedown</a></p></form>';
    var f = document.getElementById("report-form");
    f.onsubmit = function (e) {
      e.preventDefault();
      var btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
      Studio.report({ image_id: p.id, character_slug: p.slug, image_url: absUrl(p.src), reason: f.reason.value, details: f.details.value })
        .then(function (r) {
          wrap.innerHTML = '<div class="report-box done"><b>' + (r === "already" ? "You already reported this image." : "Thanks, we got your report.") + '</b>' +
            '<p>We review every report. If it breaks our <a href="content-policy.html">Content Policy</a>, it comes down.</p></div>';
        }, function (x) {
          btn.disabled = false; btn.textContent = "Send report";
          var er = f.querySelector(".err") || f.insertBefore(Object.assign(document.createElement("p"), { className: "err" }), f.querySelector(".muted"));
          er.textContent = x.message || "Couldn't send. Please try again.";
        });
    };
    f.querySelector("[data-report-cancel]").onclick = function () {
      wrap.innerHTML = '<button class="linkbtn report-link" data-report="' + esc(p.id) + '">' + ICON.flag + 'Report this image</button>';
    };
  });
}
document.addEventListener("click", function (e) {
  var r = e.target.closest("[data-report]"); if (r) { e.preventDefault(); openReport(r.dataset.report); return; }
  var cp = e.target.closest("[data-copy-recipe]");
  if (cp) {
    var txt = cp.parentNode.querySelector("p").textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { cp.textContent = "Copied"; }, function () {});
  }
});

function closePin() { var b = document.getElementById("closeup"); if (b) b.classList.remove("open"); document.body.style.overflow = ""; }
document.addEventListener("click", function (e) { if (e.target.id === "closeup") closePin(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePin(); });

// Load every character's live images once; pages render from this.
function loadAllLive() {
  return Promise.all([Studio.ready, Social.ready]).then(function () {
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
// touch (side by side or stacked). Pass {mixed:false} on single-character pages to skip that rule,
// and {ordered:true} to keep pins as close as possible to the order given (the personal homepage feed).
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
  var res = opts.ordered ? orderedLayout(pins, cols, ratio, meta, pad) : null;
  if (!res) {
    res = attempt(false);
    for (var t = 0; mixed && t < 1500 && res.clashes > 0; t++) { var r2 = attempt(true); if (r2.clashes < res.clashes) res = r2; }
  }
  el._cols = cols;
  el.classList.add("pins-cols");
  el.style.setProperty("--cols", cols);
  el.innerHTML = res.col.map(function (x) {
    return '<div class="pcol">' + x.items.map(function (it, i) { return pinHtml(it.p, i); }).join("") + '</div>';
  }).join("");
  fillAvatars(el);
  if (window.Feed) Feed.watch(el);
}

// Ordered feed layout. Pins fill the shortest column one at a time, in feed order. When the next pin would
// sit beside or under a pin of the same character, the next one in line that fits goes there instead, and
// if a dead end is reached it steps back and tries again. So the feed order is kept as far as the
// "never adjacent" rule allows. Returns null if no clean layout is found quickly (the caller then uses the
// classic layout).
function orderedLayout(pins, cols, ratio, meta, pad) {
  var col = [], left = pins.slice(), budget = 20000;
  for (var k = 0; k < cols; k++) col.push({ h: 0, items: [] });
  function touches(slug, c, top, bot) {
    var me = col[c].items[col[c].items.length - 1];
    if (me && me.slug === slug) return 2;
    var near = 0;
    for (var j = c - 1; j <= c + 1; j += 2) {
      if (j < 0 || j >= cols) continue;
      for (var i = 0; i < col[j].items.length; i++) {
        var it = col[j].items[i]; if (it.slug !== slug) continue;
        if (it.top < bot && it.bot > top) return 2;                       // side by side
        if (it.top < bot + pad && it.bot + pad > top) near = 1;            // corner to corner: allowed, avoided if cheap
      }
    }
    return near;
  }
  function place() {
    if (!left.length) return true;
    if (--budget < 0) return false;
    var c = 0; col.forEach(function (x, j) { if (x.h < col[c].h - 0.001) c = j; });
    var top = col[c].h, tries = [];
    left.forEach(function (p, i) {
      var bot = top + ratio(p) + meta, t = touches(p.slug, c, top, bot);
      if (t < 2) tries.push({ i: i, p: p, bot: bot, cost: i + t * 0.5 });
    });
    tries.sort(function (a, b) { return a.cost - b.cost; });
    var seenSlug = {};
    for (var n = 0; n < tries.length; n++) {
      var tr = tries[n];
      if (seenSlug[tr.p.slug + "|" + tr.bot.toFixed(3)]) continue;     // same character and shape: same outcome
      seenSlug[tr.p.slug + "|" + tr.bot.toFixed(3)] = 1;
      left.splice(tr.i, 1);
      col[c].items.push({ slug: tr.p.slug, p: tr.p, top: top, bot: tr.bot }); col[c].h = tr.bot;
      if (place()) return true;
      col[c].items.pop(); col[c].h = top;
      left.splice(tr.i, 0, tr.p);
      if (budget < 0) return false;
    }
    return false;
  }
  return place() ? { col: col, clashes: 0 } : null;
}
