// Library page: Persona House looks. Each look shows its reference pin (Pinterest's own embed, the photo is not copied)
// and one "View JSON" row per block with a Copy button, plus "Copy all" (a character recipe Studio > Combine can paste).
(function () {
  var ORDER = ["face", "body", "hair", "wardrobe", "camera", "light", "location", "scene", "motion", "mood", "pose"];
  var LABEL = { face: "Face", body: "Body", hair: "Hair", wardrobe: "Outfit", camera: "Camera", light: "Light", location: "Location",
    scene: "Scene", motion: "Motion", mood: "Mood", pose: "Pose" };
  var PAGE = 24, AUTHOR = "Persona House";
  var S = { looks: [], q: "", tag: "all", shown: PAGE };
  var grid = document.getElementById("lib-grid");

  function h(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function n3(n) { return String(n).padStart(3, "0"); }
  function count(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n); }

  // Rebuilds the full, portable block (same shape as templates/block-template.json and lib/blocks.js share()).
  function block(look, type) {
    var o = { persona_block: 1, address: type + "@" + look.name + "/v1", type: type, name: look.name, version: 1,
      title: look.title + " · " + (LABEL[type] || type).toLowerCase(), author: AUTHOR, preview: null, data: look.b[type], remix_of: null,
      tags: ["house"].concat(look.tags.slice(0, 5).map(function (t) { return t.replace(/\s+/g, "-"); })) };
    if (type === "face") o.likeness = "invented";
    return o;
  }
  function recipe(look) {
    var r = { persona_character: 1, name: "Look " + n3(look.n) + ": " + look.title, blocks: {}, remix_of: null, included: [],
      source: "https://www.pinterest.com/pin/" + look.pin + "/" };
    ORDER.forEach(function (t) { if (look.b[t]) { r.blocks[t] = t + "@" + look.name + "/v1"; r.included.push(block(look, t)); } });
    return r;
  }

  function copy(btn, text) {
    function done() { var t = btn.textContent; btn.textContent = "Copied"; btn.classList.add("ok"); setTimeout(function () { btn.textContent = t; btn.classList.remove("ok"); }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    else { fallback(text); done(); }
  }
  function fallback(text) {
    var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove();
  }
  function download(name, obj) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function matches(look) {
    if (S.tag !== "all" && look.tags.indexOf(S.tag) < 0) return false;
    if (!S.q) return true;
    var hay = (look.title + " " + look.tags.join(" ") + " " + look.palette.join(" ") + " " + JSON.stringify(look.b)).toLowerCase();
    return S.q.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
  }

  function card(look) {
    var rows = ORDER.filter(function (t) { return look.b[t]; }).map(function (t) {
      return '<details class="lib-blob" data-type="' + t + '"><summary><span class="lib-blob-name">' + LABEL[t] + '</span>' +
        '<span class="lib-blob-view">View JSON</span><button class="lib-copy" data-copy="' + t + '" type="button">Copy</button></summary>' +
        '<pre></pre></details>';
    }).join("");
    var url = "https://www.pinterest.com/pin/" + look.pin + "/";
    return '<article class="lib-card" data-n="' + look.n + '">' +
      '<div class="lib-ref" style="aspect-ratio:1/' + (look.ratio || 1.5) + '">' +
        '<iframe src="https://assets.pinterest.com/ext/embed.html?id=' + h(look.pin) + '" loading="lazy" scrolling="no" frameborder="0" title="Reference pin for look ' + n3(look.n) + '"></iframe>' +
      '</div>' +
      '<div class="lib-meta">' +
        '<h2><span>' + n3(look.n) + '</span> ' + h(look.title) + '</h2>' +
        '<p>' + count(look.saves) + ' saves · <a href="' + url + '" target="_blank" rel="noopener">' + h(look.board) + ' on Pinterest</a></p>' +
        '<div class="lib-tags">' + look.tags.map(function (t) { return '<button type="button" data-tag="' + h(t) + '">' + h(t) + '</button>'; }).join("") + '</div>' +
      '</div>' +
      '<div class="lib-blobs">' + rows + '</div>' +
      '<div class="lib-all"><button class="chip" data-all="copy" type="button">Copy all blocks</button>' +
        '<button class="chip" data-all="download" type="button">Download .json</button></div>' +
    '</article>';
  }

  function render() {
    var list = S.looks.filter(matches);
    document.getElementById("lib-count").textContent = list.length + (list.length === 1 ? " look" : " looks") +
      (S.tag !== "all" || S.q ? " match" : "") + " · " + list.reduce(function (a, l) { return a + Object.keys(l.b).length; }, 0) + " blocks";
    grid.innerHTML = list.length ? list.slice(0, S.shown).map(card).join("") : '<p class="empty-pins">No looks match that yet.</p>';
    document.getElementById("lib-more").hidden = list.length <= S.shown;
    chips();
  }
  function chips() {
    var t = {}; S.looks.forEach(function (l) { l.tags.forEach(function (g) { t[g] = (t[g] || 0) + 1; }); });
    var top = Object.keys(t).filter(function (g) { return t[g] >= 6; }).sort(function (a, b) { return t[b] - t[a]; }).slice(0, 18);
    if (S.tag !== "all" && top.indexOf(S.tag) < 0) top.unshift(S.tag);
    document.getElementById("lib-chips").innerHTML = ["all"].concat(top).map(function (g) {
      return '<button class="chip' + (S.tag === g ? " on" : "") + '" data-chip="' + h(g) + '">' + (g === "all" ? "All" : h(g)) + '</button>';
    }).join("");
  }
  function lookOf(el) { var c = el.closest(".lib-card"); return c && S.looks.filter(function (l) { return l.n === +c.dataset.n; })[0]; }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.dataset.copy) {
      e.preventDefault(); e.stopPropagation();
      copy(t, JSON.stringify(block(lookOf(t), t.dataset.copy), null, 2));
    } else if (t.dataset.all) {
      var look = lookOf(t);
      if (t.dataset.all === "copy") copy(t, JSON.stringify(recipe(look), null, 2));
      else download("persona-look-" + n3(look.n) + ".json", recipe(look));
    } else if (t.dataset.chip || t.dataset.tag) {
      S.tag = t.dataset.chip || t.dataset.tag; S.shown = PAGE; render();
      if (t.dataset.tag) window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (t.id === "lib-more") { S.shown += PAGE; render(); }
  });
  // Fill the JSON only when a row is opened, so the page stays light.
  grid.addEventListener("toggle", function (e) {
    var d = e.target;
    if (!d.classList || !d.classList.contains("lib-blob") || !d.open) return;
    var pre = d.querySelector("pre");
    if (!pre.textContent) pre.textContent = JSON.stringify(block(lookOf(d), d.dataset.type), null, 2);
  }, true);
  var timer;
  document.getElementById("lib-q").addEventListener("input", function (e) {
    clearTimeout(timer);
    timer = setTimeout(function () { S.q = e.target.value.trim().toLowerCase(); S.shown = PAGE; render(); }, 150);
  });

  var tagParam = new URLSearchParams(location.search).get("tag");
  if (tagParam) S.tag = tagParam;
  fetch("templates/library.json").then(function (r) { return r.json(); }).then(function (d) {
    S.looks = d.looks || []; render();
  }).catch(function () { grid.innerHTML = '<p class="empty-pins">The library didn\'t load. Refresh to try again.</p>'; });
})();
