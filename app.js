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
  var opts = CHARACTERS.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join("");
  el.className = "nav";
  el.innerHTML =
    '<a class="wordmark" href="./" aria-label="Persona home">' + MARK + '<span>Persona</span></a>' +
    '<div class="nav-right">' +
      '<form class="search" role="search" id="search-form">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
        '<input id="search" type="search" placeholder="Search characters, looks, creators" list="search-list" autocomplete="off" aria-label="Search characters">' +
        '<datalist id="search-list">' + opts + '</datalist>' +
      '</form>' +
      '<a class="nav-saved" href="saved.html" aria-label="Saved">' + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg><span>Saved</span></a>' +
      '<a class="avatar" href="studio.html" title="' + esc(CREATOR.name) + '" aria-label="Your profile and studio">' +
        esc(CREATOR.name.split(" ").map(function (w) { return w[0]; }).join("")) + '</a>' +
    '</div>';
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
  var c = charBySlug(p.slug), saved = Social.isSaved(p.id);
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
  return Promise.all(CHARACTERS.map(function (c) { return Studio.liveFor(c); })).then(function (lists) {
    var out = {};
    lists.forEach(function (l, i) { var c = CHARACTERS[i]; out[c.slug] = l.map(function (im) { return toPin(c, im); }); if (l[0]) AVATARS[c.slug] = l[0].src; });
    return out;
  });
}
