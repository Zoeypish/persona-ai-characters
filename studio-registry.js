// Studio extras: Character spec (versioned registry), Shot builder (camera + scene presets) and Drift guard.
// Uses Supabase when connected (supabase/character-registry.sql), otherwise this browser (demo mode).
(function () {
  var sb = Studio.client, DEMO = Studio.mode !== "supabase";
  var SETUP = "This needs a one-time switch-on: the site owner runs supabase/character-registry.sql in Supabase.";
  var presets = null;
  var presetsReady = fetch("templates/presets.json").then(function (r) { return r.json(); }).then(function (p) { presets = p; return p; });
  var exampleReady = fetch("templates/example-nova-reyes-spec.json").then(function (r) { return r.json(); }).catch(function () { return null; });

  var S = { c: null, list: [], view: "images", versions: [], meta: {}, pending: null, last: null, prevIds: {}, off: false, form: null, loadedFrom: null, hashing: false };

  // ---------- data ----------
  function rj(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function wj(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function notOn(e) { return e && /character_versions|registry_save|recipe|phash|on_model|ai_check|spec_version|schema cache|does not exist|Could not find/i.test(e.message || ""); }
  var Data = {
    versions: function (slug) {
      if (DEMO) return Promise.resolve(((rj("persona-registry-v1") || {})[slug] || []).slice().reverse());
      return sb.from("character_versions").select("version,spec,note,created_at").eq("character_slug", slug).order("version", { ascending: false })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    save: function (slug, spec, note) {
      if (DEMO) {
        var all = rj("persona-registry-v1") || {}, l = all[slug] || [];
        var row = { version: l.length + 1, spec: Object.assign({}, spec, { id: slug }), note: note || null, created_at: new Date().toISOString() };
        l.push(row); all[slug] = l; wj("persona-registry-v1", all); return Promise.resolve(row);
      }
      return sb.rpc("registry_save", { p_slug: slug, p_spec: spec, p_note: note || null }).then(function (r) { if (r.error) throw r.error; return r.data; });
    },
    meta: function (slug) {
      if (DEMO) return Promise.resolve(rj("persona-imgmeta-v1") || {});
      return sb.from("images").select("id,recipe,spec_version,phash,on_model,ai_check").eq("character_slug", slug).then(function (r) {
        if (r.error) throw r.error;
        var m = {}; (r.data || []).forEach(function (x) { m[x.id] = x; }); return m;
      });
    },
    setMeta: function (c, im, patch) {
      S.meta[im.id] = Object.assign({}, S.meta[im.id] || {}, patch);
      if (DEMO) { var all = rj("persona-imgmeta-v1") || {}; all[im.id] = S.meta[im.id]; wj("persona-imgmeta-v1", all); return Promise.resolve(); }
      var q = im.uploaded ? sb.from("images").update(patch).eq("id", im.id)
        : sb.from("images").upsert(Object.assign({ id: im.id, character_slug: c.slug, live: !!im.live }, patch), { onConflict: "id" });
      return q.then(function (r) { if (r.error) throw r.error; });
    },
  };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function latest() { return S.versions[0] || null; }
  function spec() { return (latest() && latest().spec) || {}; }
  function fmt(d) { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  function byId(id) { return S.list.filter(function (im) { return im.id === id; })[0]; }
  function refSrc(r) { var im = r.image_id && byId(r.image_id); return (im && im.src) || r.url; }
  function imgs() { return S.list.map(function (im) { return Object.assign({}, im, S.meta[im.id] || {}); }); }
  function newestFirst() { return imgs().slice().reverse(); }
  function recipeLabel(r) {
    if (!r || !presets) return "";
    return Shot.GROUPS.map(function (g) { var p = r[g] && Shot.find(presets, g, r[g]); return p ? p.name : null; }).filter(Boolean).join(" · ");
  }
  function say(el, t, bad) { el.textContent = t || ""; el.className = "ct-msg" + (bad ? " err" : ""); }
  function copy(btn, text) {
    navigator.clipboard.writeText(text).then(function () { var t = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = t; }, 1400); }, function () {});
  }
  function download(name, obj) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function thumb(src, alt) { return '<span class="sp-th"><img src="' + esc(src) + '" alt="' + esc(alt || "") + '" loading="lazy"></span>'; }

  // 64-bit difference hash of a picture (9x8 greyscale). Similar pictures get similar hashes.
  function dhash(src) {
    return new Promise(function (res) {
      var img = new Image(); img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var cv = document.createElement("canvas"); cv.width = 9; cv.height = 8;
          var x = cv.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, 9, 8);
          var d = x.getImageData(0, 0, 9, 8).data, bits = "", hex = "";
          for (var y = 0; y < 8; y++) for (var i = 0; i < 8; i++) {
            var a = (y * 9 + i) * 4, b = a + 4;
            bits += (d[a] * .299 + d[a + 1] * .587 + d[a + 2] * .114) > (d[b] * .299 + d[b + 1] * .587 + d[b + 2] * .114) ? "1" : "0";
          }
          for (var k = 0; k < 64; k += 4) hex += parseInt(bits.slice(k, k + 4), 2).toString(16);
          res(hex);
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = src;
    });
  }

  // ---------- sub-tabs ----------
  var VIEWS = [["images", "Images"], ["spec", "Character spec"], ["shot", "Shot builder"], ["drift", "Drift guard"]];
  function tabs() {
    $("subtabs").innerHTML = VIEWS.map(function (v) { return '<button data-v="' + v[0] + '" class="' + (S.view === v[0] ? "on" : "") + '">' + v[1] + "</button>"; }).join("");
    $("subtabs").querySelectorAll("button").forEach(function (b) { b.onclick = function () { go(b.dataset.v); }; });
  }
  function go(v) {
    S.view = v; tabs();
    var main = v === "images";
    ["allowance", "origin-box", "rights-box", "drop", "grid"].forEach(function (id) { if ($(id)) $(id).hidden = !main; });
    document.querySelector(".studio-bar").hidden = !main;
    $("sp-panel").hidden = main;
    if (v === "spec") renderSpec();
    if (v === "shot") renderShot();
    if (v === "drift") renderDrift();
  }

  // ---------- Character spec ----------
  var FIELDS = [
    ["identity", "Identity", [
      ["identity.sentence", "Identity sentence", "One sentence: face, hair and signature detail. Pasted word for word into every prompt.", "area"],
      ["identity.age_range", "Age range", "e.g. mid 20s"], ["identity.face", "Face", "Face shape and features"],
      ["identity.eyes", "Eyes", "Colour and shape"], ["identity.skin", "Skin", "Tone, freckles, marks"],
      ["identity.hair", "Hair", "Colour, length and cut"], ["identity.body", "Body", "Height and build"],
      ["identity.signature_detail", "Signature detail", "What people recognise instantly"],
      ["identity.never_change", "Never change", "Comma separated, e.g. pink hair, freckles, ear cuff", "list"]]],
    ["style", "Style", [
      ["style.keywords", "Style words", "e.g. minimal, streetwear, monochrome", "list"],
      ["style.palette", "Colours", "e.g. black, cream, chrome", "list"],
      ["style.outfit_staples", "Outfit staples", "Pieces they wear often", "list"]]],
    ["world", "World", [
      ["world.home_city", "Home city", "Used by the Home city location preset"],
      ["world.hobby", "Hobby", "Used by the Doing their hobby pose preset"],
      ["avoid", "Never show", "Comma separated", "list"]]],
  ];
  function get(o, path) { return path.split(".").reduce(function (a, k) { return a && a[k]; }, o); }
  function put(o, path, v) { var ks = path.split("."), t = o; ks.slice(0, -1).forEach(function (k) { t = t[k] = t[k] || {}; }); t[ks[ks.length - 1]] = v; }
  function readForm() {
    var out = JSON.parse(JSON.stringify(S.form || {}));
    document.querySelectorAll("#sp-panel [data-k]").forEach(function (el) {
      var v = el.value.trim();
      put(out, el.dataset.k, el.dataset.list ? v.split(",").map(function (x) { return x.trim(); }).filter(Boolean) : v);
    });
    out.references = (S.form && S.form.references) || [];
    return out;
  }
  function clean(o) { return JSON.stringify(o, function (k, v) { return v === "" || (Array.isArray(v) && !v.length && k !== "references") ? undefined : v; }); }

  function renderSpec() {
    var c = S.c, l = latest(), p = $("sp-panel");
    if (!S.form) S.form = JSON.parse(JSON.stringify(l ? l.spec : {}));
    var f = S.form, refs = f.references || [];
    var head = '<div class="sp-head"><div><h2>Character spec</h2><p class="sub">The single source of truth for how ' + esc(c.name) + ' looks. Your AI tool reads the latest version before every image, so the face stays the same.</p></div>' +
      '<dl class="sp-meta"><div><dt>Stable ID</dt><dd><code>' + esc(c.slug) + '</code></dd></div><div><dt>Current</dt><dd>' + (l ? "v" + l.version : "No spec yet") + '</dd></div></dl></div>';
    if (S.off) { p.innerHTML = head + '<p class="sp-warn">' + SETUP + '</p>'; return; }
    var banner = S.loadedFrom ? '<p class="sp-note">Showing v' + S.loadedFrom + '. Saving creates a new version from it; nothing old is changed.</p>' : "";
    var form = FIELDS.map(function (sec) {
      return '<fieldset class="sp-fs"><legend>' + sec[1] + '</legend><div class="sp-fields">' + sec[2].map(function (x) {
        var v = get(f, x[0]); v = Array.isArray(v) ? v.join(", ") : (v || "");
        var attrs = ' data-k="' + x[0] + '"' + (x[3] === "list" ? ' data-list="1"' : "") + ' placeholder="' + esc(x[2]) + '" aria-label="' + esc(x[1]) + '"';
        return '<label class="ct-field' + (x[3] === "area" ? " wide" : "") + '"><span>' + x[1] + '</span>' +
          (x[3] === "area" ? '<textarea rows="3"' + attrs + '>' + esc(v) + '</textarea>' : '<input type="text"' + attrs + ' value="' + esc(v) + '">') + '</label>';
      }).join("") + '</div></fieldset>';
    }).join("");
    var refHtml = '<fieldset class="sp-fs"><legend>Reference sheet</legend><p class="sub">The locked face and body. Pick 2 to 4 images where ' + esc(c.name) + ' looks exactly right: a clear face, a full body, a profile. Every new image is checked against these, and they are attached to every prompt.</p>' +
      '<div class="sp-refs">' + (refs.length ? refs.map(function (r, i) {
        return '<div class="sp-ref">' + thumb(refSrc(r), "Reference " + (i + 1)) + '<select data-role="' + i + '" aria-label="What this reference shows">' +
          ["face", "full body", "profile", "style"].map(function (o) { return '<option' + (r.role === o ? " selected" : "") + '>' + o + '</option>'; }).join("") +
          '</select><button type="button" class="linkbtn" data-unref="' + i + '">Remove</button></div>';
      }).join("") : '<p class="muted">No references yet. Click images below to add them.</p>') + '</div>' +
      (S.list.length ? '<div class="sp-pick">' + S.list.map(function (im) {
        var on = refs.some(function (r) { return r.image_id === im.id; });
        return '<button type="button" class="sp-pickbtn' + (on ? " on" : "") + '" data-ref="' + esc(im.id) + '" title="' + (on ? "Already a reference" : "Use as reference") + '">' + thumb(im.src, "") + '</button>';
      }).join("") + '</div>' : '<p class="muted">Upload images first, then pick references here.</p>') + '</fieldset>';
    var hist = S.versions.length ? '<div class="sp-hist"><h3>History</h3><ol>' + S.versions.map(function (v) {
      return '<li><b>v' + v.version + '</b><span>' + esc(v.note || "No note") + '</span><small>' + fmt(v.created_at) + '</small>' +
        '<button type="button" class="linkbtn" data-load="' + v.version + '">' + (v === l ? "Reset to this" : "Restore") + '</button>' +
        '<button type="button" class="linkbtn" data-dl="' + v.version + '">JSON</button></li>';
    }).join("") + '</ol></div>' : "";
    var next = (l ? l.version : 0) + 1;
    p.innerHTML = head + banner + '<form id="sp-form" autocomplete="off">' + form + refHtml +
      '<div class="sp-save"><input type="text" id="sp-note" maxlength="200" placeholder="What changed? e.g. Shorter fringe, added profile reference" aria-label="Version note">' +
      '<button class="btn" type="submit" id="sp-go">Save as v' + next + '</button>' +
      '<button class="btn ghost" type="button" id="sp-copy">Copy JSON</button></div><p class="ct-msg" id="sp-msg" role="status"></p></form>' + hist;
    if (!l && !S.loadedFrom && !get(f, "identity.sentence")) {
      exampleReady.then(function (ex) {
        if (ex && c.slug === "nova-reyes" && S.view === "spec" && !latest()) $("sp-msg").innerHTML = 'Start from scratch, or <button type="button" class="linkbtn" id="sp-ex">fill in the Nova Reyes example</button>.';
        var b = $("sp-ex"); if (b) b.onclick = function () { S.form = Object.assign(JSON.parse(JSON.stringify(ex)), { references: (S.form || {}).references || [] }); renderSpec(); };
      });
    }
    function keep() { S.form = readForm(); }
    p.querySelectorAll("[data-ref]").forEach(function (b) {
      b.onclick = function () {
        keep(); var im = byId(b.dataset.ref); var rs = S.form.references || (S.form.references = []);
        if (rs.some(function (r) { return r.image_id === im.id; }) || rs.length >= 6) return;
        var roles = ["face", "full body", "profile", "style"];
        rs.push({ image_id: im.id, url: im.uploaded ? im.src : new URL(im.src, location.href).href, role: roles[Math.min(rs.length, 3)] });
        renderSpec();
      };
    });
    p.querySelectorAll("[data-unref]").forEach(function (b) { b.onclick = function () { keep(); S.form.references.splice(+b.dataset.unref, 1); renderSpec(); }; });
    p.querySelectorAll("[data-role]").forEach(function (s) { s.onchange = function () { S.form.references[+s.dataset.role].role = s.value; }; });
    p.querySelectorAll("[data-load]").forEach(function (b) {
      b.onclick = function () {
        var v = S.versions.filter(function (x) { return x.version === +b.dataset.load; })[0];
        S.form = JSON.parse(JSON.stringify(v.spec)); S.loadedFrom = v === latest() ? null : v.version; renderSpec();
      };
    });
    p.querySelectorAll("[data-dl]").forEach(function (b) {
      b.onclick = function () { var v = S.versions.filter(function (x) { return x.version === +b.dataset.dl; })[0]; download(c.slug + "-v" + v.version + ".json", v.spec); };
    });
    $("sp-copy").onclick = function () { copy($("sp-copy"), JSON.stringify(Object.assign({ id: c.slug }, JSON.parse(clean(readForm()))), null, 2)); };
    $("sp-form").onsubmit = function (e) {
      e.preventDefault();
      var data = JSON.parse(clean(readForm())), msg = $("sp-msg"), btn = $("sp-go");
      if (l && clean(data) === clean(Object.assign({}, l.spec, { id: undefined }))) { say(msg, "Nothing changed since v" + l.version + "."); return; }
      if (!get(data, "identity.sentence")) { say(msg, "Write the identity sentence first. It's the one thing every prompt needs.", true); return; }
      btn.disabled = true; say(msg, "Saving…");
      var note = $("sp-note").value.trim() || (S.loadedFrom ? "Restored from v" + S.loadedFrom : l ? "" : "First version");
      Data.save(c.slug, data, note).then(function (row) {
        return Data.versions(c.slug).then(function (v) {
          S.versions = v; S.form = null; S.loadedFrom = null; renderSpec();
          say($("sp-msg"), "Saved as v" + row.version + ". Your AI tool will use it from now on.");
        });
      }).catch(function (x) { btn.disabled = false; say(msg, notOn(x) ? SETUP : x.message, true); });
    };
  }

  // ---------- Shot builder (camera rig, wardrobe, model router, prompt compiler, recipes) ----------
  function wardrobeSearch(q) {
    if (!sb) return Promise.reject(new Error("The product catalog connects on the live site."));
    var words = q.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(function (w) { return w.length > 1; }).slice(0, 4);
    if (!words.length) return Promise.resolve([]);
    var qq = sb.from("persona_products").select("id,store,title,price,currency,image,link").eq("available", true).limit(12);
    words.forEach(function (w) { qq = qq.ilike("title", "%" + w + "%"); });
    return qq.then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function shareLink(rec) {
    return location.origin + location.pathname + "#recipe=" + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(rec)))));
  }
  function renderShot(pre) {
    var p = $("sp-panel"), c = S.c, l = latest();
    var choice = pre || S.choice || {};
    S.choice = choice; S.wear = S.wear || [];
    var groups = presets.groups.map(function (g) {
      return '<label class="ct-field"><span>' + g.name + '</span><select data-g="' + g.key + '"><option value="">Fresh pick for me</option>' +
        presets[g.key].map(function (o) { return '<option value="' + o.id + '"' + (choice[g.key] === o.id ? " selected" : "") + '>' + esc(o.name) + (o.shop === false ? " (no outfit)" : "") + '</option>'; }).join("") +
        '</select><small>' + g.hint + '</small></label>';
    }).join("");
    var models = '<option value="">Let Persona pick</option>' + presets.models.map(function (m) {
      return '<option value="' + m.id + '"' + (choice.model === m.id ? " selected" : "") + '>' + esc(m.name) + ' · ' + m.credits + ' credit' + (m.credits === 1 ? "" : "s") + '</option>';
    }).join("");
    p.innerHTML = '<div class="sp-head"><div><h2>Shot builder</h2><p class="sub">Pick a camera, light, place and pose, dress ' + esc(c.name) + ' from the real catalog, and Persona writes the prompt for the image tool that suits the shot best.</p></div></div>' +
      (S.off ? '<p class="sp-warn">' + SETUP + '</p>' : !l ? '<p class="sp-warn">Save a <button class="linkbtn" id="sp-tospec">Character spec</button> first, so prompts include the identity sentence.</p>' : "") +
      '<div class="sp-shot"><div class="sp-sel">' + groups +
      '<label class="ct-field wide"><span>Outfit</span><input type="text" id="sp-outfit" maxlength="200" placeholder="Optional, e.g. cream trench coat, black turtleneck, loafers" value="' + esc(choice.outfit || "") + '"></label>' +
      '<div class="ct-field wide"><span>Wardrobe from the catalog</span><div class="ct-copy"><input type="text" id="sp-wq" placeholder="Search real products, e.g. black boots" aria-label="Search the product catalog"><button class="btn ghost" type="button" id="sp-wgo">Search</button></div>' +
      '<div class="sp-wear" id="sp-wear"></div><div class="sp-wres" id="sp-wres"></div></div>' +
      '<label class="ct-field"><span>Image tool</span><select id="sp-model">' + models + '</select></label>' +
      '<label class="ct-field"><span>Budget</span><select id="sp-budget"><option value="balanced">Balanced</option><option value="low"' + (choice.budget === "low" ? " selected" : "") + '>Lowest cost</option><option value="best"' + (choice.budget === "best" ? " selected" : "") + '>Best quality</option></select></label>' +
      '<div class="sp-btns"><button class="btn" type="button" id="sp-build">Build prompt</button><button class="btn ghost" type="button" id="sp-surprise">Surprise me</button></div>' +
      '<details class="sp-fork wide"><summary>Fork a recipe</summary><p class="sub">Paste a recipe someone shared (or one of your own) to reuse its camera, light, place, pose and outfit on ' + esc(c.name) + '.</p>' +
      '<textarea id="sp-rec" rows="4" placeholder=\'{"persona_recipe": 1, "camera": "cam-35-full", ...}\'></textarea><button class="btn ghost" type="button" id="sp-recgo">Load recipe</button><p class="ct-msg" id="sp-recmsg"></p></details>' +
      '</div><div class="sp-out" id="sp-out"><p class="muted">Your prompt appears here.</p></div></div>';
    var tospec = $("sp-tospec"); if (tospec) tospec.onclick = function () { go("spec"); };
    function drawWear() {
      $("sp-wear").innerHTML = S.wear.map(function (w, i) {
        return '<span class="sp-chip">' + (w.image ? '<img src="' + esc(w.image) + '" alt="">' : "") + esc(w.title) + ' <small>' + esc(w.store || "") + '</small><button type="button" data-unwear="' + i + '" aria-label="Remove">×</button></span>';
      }).join("");
      $("sp-wear").querySelectorAll("[data-unwear]").forEach(function (b) { b.onclick = function () { S.wear.splice(+b.dataset.unwear, 1); drawWear(); }; });
    }
    drawWear();
    function searchW() {
      var q = $("sp-wq").value.trim(), box = $("sp-wres");
      if (q.length < 2) return;
      box.innerHTML = '<p class="muted">Searching…</p>';
      wardrobeSearch(q).then(function (items) {
        box.innerHTML = items.length ? items.map(function (it, i) {
          return '<button type="button" class="sp-prod" data-wear="' + i + '" title="Add to outfit">' + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : "") +
            '<span>' + esc(it.title) + '</span><small>' + esc(it.store) + (it.price ? " · " + esc(it.price) + " " + esc(it.currency || "") : "") + '</small></button>';
        }).join("") : '<p class="muted">Nothing found. Try one word, like "boots".</p>';
        box.querySelectorAll("[data-wear]").forEach(function (b) {
          b.onclick = function () { var it = items[+b.dataset.wear]; if (!S.wear.some(function (w) { return w.id === it.id; }) && S.wear.length < 6) S.wear.push(it); drawWear(); };
        });
      }, function (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
    }
    $("sp-wgo").onclick = searchW;
    $("sp-wq").onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); searchW(); } };
    function pick() {
      var ch = {}; p.querySelectorAll("[data-g]").forEach(function (s) { if (s.value) ch[s.dataset.g] = s.value; });
      ch.outfit = $("sp-outfit").value.trim(); ch.model = $("sp-model").value; ch.budget = $("sp-budget").value; return ch;
    }
    function recent() { return newestFirst().map(function (im) { return im.recipe; }).filter(Boolean); }
    function build(ch) {
      var fresh = Shot.surprise(presets, recent());
      Shot.GROUPS.forEach(function (g) { if (!ch[g]) ch[g] = fresh[g]; });
      S.choice = ch;
      p.querySelectorAll("[data-g]").forEach(function (s) { s.value = ch[s.dataset.g] || ""; });
      var outfit = [ch.outfit].concat(S.wear.map(function (w) { return w.title; })).filter(Boolean).join(", ");
      var shot = Shot.build(spec(), presets, Object.assign({}, ch, { outfit: outfit }), l && l.version), v = Shot.variety(presets, recent(), ch);
      var router = Shot.route(shot, presets, { budget: ch.budget });
      var model = ch.model || router.pick.id, out = Shot.compile(shot, presets, model, c.slug);
      var rec = Shot.toRecipe(c.slug, l && l.version, ch, model, S.wear.map(function (w) { return String(w.id); }));
      shot.recipe.model = model; if (rec.products) shot.recipe.products = rec.products;
      S.last = shot;
      var refs = (spec().references || []);
      var params = Object.keys(out.params || {}).map(function (k) { return k + ": " + out.params[k]; }).join(" · ");
      $("sp-out").innerHTML = '<div class="sp-res"><div class="sp-res-top"><span class="ct-pill">' + esc(recipeLabel(shot.recipe)) + '</span>' + (l ? '<span class="ct-pill">Spec v' + l.version + '</span>' : "") + '</div>' +
        (v.choice_warnings.length ? '<ul class="sp-alerts">' + v.choice_warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + '</ul>' : '<p class="sp-ok">Fresh set-up. Nothing like it in your recent images.</p>') +
        '<div class="sp-route"><b>' + (ch.model ? "You picked" : "Persona picked") + ': ' + esc(out.model_name) + '</b> · ' + out.credits + ' credit' + (out.credits === 1 ? "" : "s") +
        (ch.model ? "" : '<br><span class="muted">' + esc(router.pick.reason) + '. Also good: ' + router.alternatives.map(function (a) { return esc(a.name) + " (" + a.credits + ")"; }).join(", ") + '</span>') + '</div>' +
        '<h3>Prompt for ' + esc(out.model_name) + '</h3><pre id="sp-prompt">' + esc(out.prompt) + '</pre>' +
        (out.negative ? '<h3>Negative prompt</h3><pre>' + esc(out.negative) + '</pre>' : "") +
        (params ? '<p class="muted small">Settings: ' + esc(params) + '</p>' : "") +
        (refs.length ? '<h3>Attach your reference sheet</h3><div class="sp-refs small">' + refs.map(function (r) { return thumb(refSrc(r), r.role); }).join("") + '</div>' : '<p class="muted small">Tip: add a reference sheet to the spec and attach it to your image tool. It is the strongest way to keep the same face.</p>') +
        '<div class="sp-btns"><button class="btn" type="button" id="sp-cp">Copy prompt</button><button class="btn ghost" type="button" id="sp-tag">Tag my next upload</button>' +
        '<button class="btn ghost" type="button" id="sp-json">Copy recipe</button><button class="btn ghost" type="button" id="sp-share">Copy share link</button></div>' +
        '<p class="ct-msg" id="sp-tagmsg"></p></div>';
      $("sp-cp").onclick = function () { copy($("sp-cp"), out.prompt + (out.negative ? "\n\nNegative: " + out.negative : "")); };
      $("sp-json").onclick = function () { copy($("sp-json"), JSON.stringify(rec, null, 2)); };
      $("sp-share").onclick = function () { copy($("sp-share"), shareLink(Object.assign({}, rec, { character: null, spec_version: null }))); };
      $("sp-tag").onclick = function () {
        S.pending = { recipe: shot.recipe, spec_version: l ? l.version : null };
        // Also fill the upload's origin record (provenance) with the tool and prompt.
        if ($("o-tool")) $("o-tool").value = out.model_name;
        if ($("o-recipe")) $("o-recipe").value = (out.prompt + "\n\nRecipe: " + JSON.stringify(rec)).slice(0, 4000);
        say($("sp-tagmsg"), "Done. The next images you upload to " + c.name + " will remember this shot and its origin (tool and prompt).");
      };
    }
    $("sp-build").onclick = function () { build(pick()); };
    $("sp-surprise").onclick = function () { var ch = Shot.surprise(presets, recent()); var cur = pick(); ch.outfit = cur.outfit; ch.model = cur.model; ch.budget = cur.budget; build(ch); };
    $("sp-recgo").onclick = function () {
      try { var r = Shot.parseRecipe($("sp-rec").value); S.wear = []; renderShot(r); say($("sp-recmsg"), ""); }
      catch (e) { say($("sp-recmsg"), "Couldn't read that recipe: " + e.message, true); }
    };
    if (pre) build(Object.assign({}, pre));
  }

  // ---------- Drift guard ----------
  function hashMissing() {
    if (S.hashing) return;
    var todo = S.list.filter(function (im) { return !(S.meta[im.id] && S.meta[im.id].phash) && im.src; });
    if (!todo.length) return;
    S.hashing = true;
    var c = S.c;
    todo.reduce(function (pr, im) {
      return pr.then(function () {
        return dhash(im.src).then(function (h) { if (h && S.c === c) return Data.setMeta(c, im, { phash: h }).catch(function () {}); });
      });
    }, Promise.resolve()).then(function () { S.hashing = false; if (S.view === "drift" && S.c === c) renderDrift(true); });
  }
  function renderDrift(noHash) {
    var p = $("sp-panel"), c = S.c, all = imgs(), newest = newestFirst();
    var v = Shot.variety(presets, newest.map(function (im) { return im.recipe; }).filter(Boolean));
    var dups = Shot.duplicates(all.filter(function (im) { return im.phash; }));
    var face = Shot.faceReport(all), refs = spec().references || [];
    var dupOf = {}; dups.forEach(function (d) { (dupOf[d.a] = dupOf[d.a] || []).push(d); (dupOf[d.b] = dupOf[d.b] || []).push(d); });
    var num = {}; all.forEach(function (im, i) { num[im.id] = i + 1; });
    var untagged = all.filter(function (im) { return !im.recipe; }).length;
    var tn = v.try_next;
    var faceTxt = face.confirmed_on_model + face.off_model ? face.confirmed_on_model + " of " + (face.confirmed_on_model + face.off_model) + " on-model" : "Not checked yet";
    p.innerHTML = '<div class="sp-head"><div><h2>Drift guard</h2><p class="sub">Two jobs: keep ' + esc(c.name) + '’s face the same in every image, and stop the feed from turning into the same picture over and over.</p></div></div>' +
      (S.off ? '<p class="sp-warn">' + SETUP + '</p>' : "") +
      '<div class="allowance sp-sum">' +
      '<div><dt>Same face</dt><dd>' + faceTxt + '</dd></div>' +
      '<div><dt>Variety</dt><dd>' + esc(v.verdict) + (v.score !== null ? " · " + v.score : "") + '</dd></div>' +
      '<div><dt>Near-duplicates</dt><dd>' + (dups.length ? dups.length + " pair" + (dups.length === 1 ? "" : "s") : "None") + '</dd></div>' +
      '<div><dt>No shot recorded</dt><dd>' + untagged + " of " + all.length + '</dd></div></div>' +
      (v.warnings.length || dups.length || face.ai_flagged.length ? '<ul class="sp-alerts">' +
        v.warnings.map(function (w) { return "<li>" + esc(w.message) + "</li>"; }).join("") +
        dups.map(function (d) { return "<li>Images #" + num[d.a] + " and #" + num[d.b] + " look " + d.level + ". Keep the stronger one live.</li>"; }).join("") +
        face.ai_flagged.map(function (id) { return "<li>Your AI tool thinks image #" + num[id] + " may be off-model. Compare it with the references.</li>"; }).join("") + '</ul>'
        : (all.length ? '<p class="sp-ok">No repeats or near-duplicates found.</p>' : "")) +
      '<div class="sp-next"><span>Try next:</span> <b>' + esc(tn.camera[0].name) + '</b> · <b>' + esc(tn.lighting[0].name) + '</b> · <b>' + esc(tn.location[0].name) + '</b> · <b>' + esc(tn.pose[0].name) + '</b>' +
      ' <button class="btn ghost" type="button" id="sp-trynext">Build this shot</button></div>' +
      '<h3 class="sp-h3">Reference sheet</h3>' + (refs.length ? '<div class="sp-refs small">' + refs.map(function (r) { return thumb(refSrc(r), r.role); }).join("") + '</div>'
        : '<p class="muted">No references yet. Mark images as references below, or in <button class="linkbtn" id="sp-tospec2">Character spec</button>.</p>') +
      '<h3 class="sp-h3">Review each image</h3><p class="sub">Does it look like the references? Your answer trains the guard for this character.</p>' +
      (all.length ? '<div class="sgrid sp-review">' + all.map(function (im, i) {
        var d = dupOf[im.id], ai = im.ai_check;
        return '<div class="sitem"><div class="tile"><span class="sp-num">#' + (i + 1) + '</span>' + tileImg(im, c.name) + '</div>' +
          '<div class="sp-card">' +
          '<small class="muted">' + (im.recipe ? esc(recipeLabel(im.recipe)) : "No shot recorded") + (im.spec_version ? " · spec v" + im.spec_version : "") + '</small>' +
          (d ? '<span class="sp-flag">' + d.map(function (x) { return "Looks " + x.level + " to #" + num[x.a === im.id ? x.b : x.a]; }).join("<br>") + '</span>' : "") +
          (ai && ai.face_score != null ? '<small class="sp-score' + (ai.face_score < 70 ? " low" : "") + '">Face match ' + esc(ai.face_score) + '/100</small>' : "") +
          (ai && ai.face != null ? '<small class="muted">AI check: face ' + esc(ai.face) + ' · hair ' + esc(ai.hair) + ' · detail ' + esc(ai.signature) + '</small>' : "") +
          '<div class="sp-yn"><button type="button" data-yes="' + i + '" class="' + (im.on_model === "yes" ? "on" : "") + '">Same face</button><button type="button" data-no="' + i + '" class="' + (im.on_model === "no" ? "on bad" : "") + '">Off-model</button></div>' +
          (!im.recipe && S.last ? '<button type="button" class="linkbtn" data-tag="' + i + '">Tag with last built shot</button>' : "") +
          '</div></div>';
      }).join("") + '</div>' : '<p class="empty">No images yet.</p>') +
      '<p class="ct-msg" id="sp-dmsg"></p>';
    $("sp-trynext").onclick = function () { go("shot"); renderShot({ camera: tn.camera[0].id, lighting: tn.lighting[0].id, location: tn.location[0].id, pose: tn.pose[0].id }); };
    var ts = $("sp-tospec2"); if (ts) ts.onclick = function () { go("spec"); };
    function mark(i, val) {
      var im = S.list[i], cur = (S.meta[im.id] || {}).on_model;
      Data.setMeta(c, im, { on_model: cur === val ? null : val }).then(function () { renderDrift(true); }, function (e) { say($("sp-dmsg"), notOn(e) ? SETUP : e.message, true); });
    }
    p.querySelectorAll("[data-yes]").forEach(function (b) { b.onclick = function () { mark(+b.dataset.yes, "yes"); }; });
    p.querySelectorAll("[data-no]").forEach(function (b) { b.onclick = function () { mark(+b.dataset.no, "no"); }; });
    p.querySelectorAll("[data-tag]").forEach(function (b) {
      b.onclick = function () { Data.setMeta(c, S.list[+b.dataset.tag], { recipe: S.last.recipe, spec_version: latest() ? latest().version : null }).then(function () { renderDrift(true); }); };
    });
    if (!noHash && !S.off) hashMissing();
  }

  // ---------- entry point (called by studio.html after each load) ----------
  window.StudioPlus = {
    show: function (c, list) {
      var changed = !S.c || S.c.slug !== c.slug;
      var prev = S.prevIds[c.slug];
      S.c = c; S.list = list;
      S.prevIds[c.slug] = list.map(function (im) { return im.id; });
      if (changed) { S.form = null; S.loadedFrom = null; S.choice = null; S.last = null; S.pending = null; S.hashing = false; S.wear = []; }
      $("subtabs").hidden = false;
      return Promise.all([presetsReady, Data.versions(c.slug).catch(function (e) { if (notOn(e)) S.off = true; return []; }),
        Data.meta(c.slug).catch(function (e) { if (notOn(e)) S.off = true; return {}; })]).then(function (r) {
        if (S.c !== c) return;
        S.versions = r[1]; S.meta = r[2];
        // Tag fresh uploads with the shot the creator just built.
        if (S.pending && prev) {
          var fresh = list.filter(function (im) { return im.uploaded && prev.indexOf(im.id) < 0; }), pend = S.pending;
          S.pending = null;
          fresh.forEach(function (im) { Data.setMeta(c, im, { recipe: pend.recipe, spec_version: pend.spec_version }).catch(function () {}); });
        }
        go(changed ? "images" : S.view);
        // Opened from a shared recipe link (studio.html#recipe=...): load it into the Shot builder.
        var m = /#recipe=([^&]+)/.exec(location.hash);
        if (m) {
          history.replaceState(null, "", location.pathname + location.search);
          try { var r = Shot.parseRecipe(decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))); S.wear = []; go("shot"); renderShot(r); } catch (e) {}
        }
      });
    },
    hide: function () { $("subtabs").hidden = true; $("sp-panel").hidden = true; },
  };
})();
