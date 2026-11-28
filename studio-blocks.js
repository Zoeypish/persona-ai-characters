// Studio: Combine. Pick blocks (face, body, hair, wardrobe, camera, light, location, mood, pose), preview the result,
// save it as a new character (or a new spec version), and publish or share your own blocks as JSON.
// Uses Supabase when connected (supabase/character-blocks.sql), otherwise this browser (demo mode).
(function () {
  var sb = Studio.client, DEMO = Studio.mode !== "supabase";
  var SETUP = "Publishing and saving blocks needs a one-time switch-on: the site owner runs supabase/character-blocks.sql in Supabase. You can still try combining the starter blocks.";
  var TYPES = Blocks.TYPES;
  var REASONS = [["real_person", "Copies a real person"], ["copyright", "Copies someone else's work"], ["sexual", "Sexual content"], ["minor", "Looks like a minor"],
    ["hate", "Hateful"], ["spam", "Spam"], ["other", "Something else"]];
  var S = { ready: null, lib: [], drafts: [], uses: {}, pick: {}, slot: null, sort: "suggested", q: "", old: false, off: false, parent: null,
    user: null, chars: [], current: null, msg: "", bad: false, model: null, presets: null, images: [] };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function rj(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function wj(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function tname(t) { return (Blocks.type(t) || {}).name || t; }
  function byAddr(a) { return S.lib.filter(function (b) { return b.address === a; })[0] || S.drafts.filter(function (b) { return b.address === a; })[0] || null; }
  function b64(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))); }
  function unb64(s) { return JSON.parse(decodeURIComponent(escape(atob(s)))); }
  function copy(btn, text) {
    navigator.clipboard.writeText(text).then(function () { var t = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = t; }, 1400); }, function () {});
  }
  function download(name, obj) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function say(t, bad) { S.msg = t || ""; S.bad = !!bad; var el = $("cb-msg"); if (el) { el.textContent = S.msg; el.className = "ct-msg" + (bad ? " err" : ""); } }
  function notOn(e) { return e && /blocks|combo_save|block_publish|schema cache|does not exist|Could not find/i.test(e.message || ""); }
  function fromRow(r) {
    return { persona_block: 1, address: r.address, type: r.type, name: r.name, version: r.version, title: r.title, data: r.data || {},
      preview: r.preview_url || r.preview || null, tags: r.tags || [], remix_of: r.remix_of || null, likeness: r.likeness || null,
      author: r.author_name || r.author || "Persona", mine: !!(S.user && r.author && r.author === S.user.id) || !!r.mine,
      visibility: r.visibility || "public", moderation: r.moderation || "ok", uses: r.uses || 0, created_at: r.created_at || null };
  }
  function newest(list) {
    var top = {};
    list.forEach(function (b) { var k = b.type + "@" + b.name; if (!top[k] || top[k].version < b.version) top[k] = b; });
    return list.filter(function (b) { return top[b.type + "@" + b.name] === b; });
  }
  function versionsOf(b) { return S.lib.filter(function (x) { return x.type === b.type && x.name === b.name; }).length; }

  // A block's preview: its image, or a lettered card when it has none.
  function preview(b, cls) {
    if (!b) return '<span class="cb-ph ' + (cls || "") + '"><i>+</i></span>';
    if (b.preview) return '<span class="cb-ph ' + (cls || "") + '"><img src="' + esc(b.preview) + '" alt="" loading="lazy"></span>';
    return '<span class="cb-ph cb-ph-' + b.type + " " + (cls || "") + '"><i>' + esc(b.title) + '</i><small>' + esc(tname(b.type)) + "</small></span>";
  }

  // ---------- data ----------
  var Data = {
    load: function () {
      var starters = fetch("templates/blocks.json").then(function (r) { return r.json(); }).then(function (j) { return j.blocks.map(fromRow); });
      var presets = fetch("templates/presets.json").then(function (r) { return r.json(); });
      S.drafts = (rj("persona-block-drafts-v1") || []).map(fromRow);
      var mine;
      if (DEMO) {
        mine = Promise.resolve((rj("persona-blocks-v1") || []).map(function (r) { return fromRow(Object.assign({ mine: true }, r)); }));
        S.uses = rj("persona-block-uses-v1") || {};
      } else {
        mine = sb.from("blocks").select("*").order("created_at", { ascending: false }).limit(2000).then(function (r) {
          if (r.error) throw r.error; return r.data || [];
        }).then(function (rows) { return rows.map(fromRow); }, function (e) { if (notOn(e)) S.off = true; return null; });
      }
      return Promise.all([starters, mine, presets]).then(function (r) {
        S.presets = r[2];
        if (DEMO || !r[1]) S.lib = r[0].concat(r[1] || []);
        else S.lib = r[1].length ? r[1] : r[0];          // Supabase has the starters too (with real use counts)
        if (!DEMO) S.uses = {};
        S.lib.forEach(function (b) { if (!DEMO && b.uses) S.uses[b.address] = b.uses; });
      });
    },
    publish: function (block, vis) {
      if (DEMO) {
        var all = rj("persona-blocks-v1") || [];
        var same = S.lib.filter(function (b) { return b.type === block.type && b.name === block.name; });
        if (same.some(function (b) { return !b.mine; })) return Promise.reject(new Error("The name " + block.type + "@" + block.name + " is taken. Pick another name (a remix keeps the link to the original)."));
        var v = same.reduce(function (m, b) { return Math.max(m, b.version); }, 0) + 1;
        var row = Object.assign({}, Blocks.share(block), { version: v, author: (S.user && S.user.name) || "You", visibility: vis, created_at: new Date().toISOString() });
        if (!row.remix_of && v > 1) row.remix_of = block.type + "@" + block.name + "/v" + (v - 1);
        row.address = Blocks.address(row);
        all.push(row); wj("persona-blocks-v1", all);
        var b = fromRow(Object.assign({ mine: true }, row)); S.lib.push(b); return Promise.resolve(b);
      }
      return sb.rpc("block_publish", { p_block: Blocks.share(block), p_visibility: vis }).then(function (r) {
        if (r.error) throw r.error; var b = fromRow(r.data); S.lib.push(b); return b;
      });
    },
    setVisibility: function (b, vis) {
      b.visibility = vis;
      if (DEMO) { var all = rj("persona-blocks-v1") || []; all.forEach(function (r) { if (r.address === b.address) r.visibility = vis; }); wj("persona-blocks-v1", all); return Promise.resolve(); }
      return sb.rpc("block_set_visibility", { p_address: b.address, p_visibility: vis }).then(function (r) { if (r.error) throw r.error; });
    },
    saveCombo: function (blocks, name, slug) {
      if (DEMO) {
        var used = rj("persona-block-used-v1") || {}, list = rj("persona-combos-v1") || [];
        Object.keys(blocks).forEach(function (t) { var a = blocks[t]; if (!used[a]) { used[a] = 1; S.uses[a] = (S.uses[a] || 0) + 1; } });
        var id = "combo-" + Date.now();
        list.push({ id: id, name: name, character_slug: slug, blocks: blocks, remix_of: S.parent, created_at: new Date().toISOString() });
        wj("persona-block-used-v1", used); wj("persona-block-uses-v1", S.uses); wj("persona-combos-v1", list);
        return Promise.resolve({ id: id, credited_authors: 0 });
      }
      return sb.rpc("combo_save", { p_blocks: blocks, p_name: name || null, p_slug: slug || null, p_remix_of: /^[0-9a-f-]{36}$/.test(S.parent || "") ? S.parent : null })
        .then(function (r) {
          if (r.error) throw r.error;
          Object.keys(blocks).forEach(function (t) { S.uses[blocks[t]] = (S.uses[blocks[t]] || 0) + 1; });
          return r.data;
        });
    },
    report: function (b, reason, details) {
      if (DEMO) { var all = rj("persona-block-reports-v1") || {}; all[b.address] = { reason: reason, details: details }; wj("persona-block-reports-v1", all); return Promise.resolve(); }
      return sb.rpc("block_report", { p_address: b.address, p_reason: reason, p_details: details || null }).then(function (r) { if (r.error) throw r.error; });
    },
    latestSpec: function (slug) {
      if (DEMO) { var l = (rj("persona-registry-v1") || {})[slug] || []; return Promise.resolve(l.length ? l[l.length - 1].spec : null); }
      return sb.from("character_versions").select("spec").eq("character_slug", slug).order("version", { ascending: false }).limit(1)
        .then(function (r) { return r.error ? null : ((r.data || [])[0] || {}).spec || null; });
    },
    saveSpec: function (slug, spec, note) {
      if (DEMO) {
        var all = rj("persona-registry-v1") || {}, l = all[slug] || [];
        var row = { version: l.length + 1, spec: Object.assign({}, spec, { id: slug }), note: note || null, created_at: new Date().toISOString() };
        l.push(row); all[slug] = l; wj("persona-registry-v1", all); return Promise.resolve(row);
      }
      return sb.rpc("registry_save", { p_slug: slug, p_spec: spec, p_note: note || null }).then(function (r) { if (r.error) throw r.error; return r.data; });
    },
  };
  function saveDrafts() { wj("persona-block-drafts-v1", S.drafts.map(Blocks.share)); }

  // ---------- main view ----------
  function render() {
    var p = $("cb-panel");
    var picked = Blocks.ORDER.filter(function (t) { return S.pick[t]; }).length;
    p.innerHTML =
      '<div class="cb-head"><div><h2>Combine</h2><p class="sub">Pick a block for each part. Blocks are small pieces anyone can share: a face, a hairstyle, an outfit, a camera, a mood. ' +
      'Mix them into a new character, then save it. When people use your blocks, you earn points.</p></div>' +
      '<div class="cb-tools"><button class="btn ghost" id="cb-surprise">Surprise me</button><button class="btn ghost" id="cb-import">Import JSON</button>' +
      (picked ? '<button class="linkbtn" id="cb-clear">Clear</button>' : "") + "</div></div>" +
      (S.off ? '<p class="sp-note">' + SETUP + "</p>" : "") +
      '<div class="cb-slots">' + TYPES.map(function (t) {
        var b = S.pick[t.id];
        return '<button class="cb-slot' + (S.slot === t.id ? " on" : "") + (b ? " full" : "") + '" data-slot="' + t.id + '">' + preview(b) +
          '<span class="cb-slot-t">' + t.name + "</span><span class=\"cb-slot-n\">" + (b ? esc(b.title) : "Choose") + "</span>" +
          (b ? '<code class="cb-addr">' + esc(b.address) + "</code>" : "") + "</button>";
      }).join("") + "</div>" +
      '<div id="cb-picker"></div>' +
      '<div id="cb-result"></div>' +
      '<div id="cb-mine"></div>';
    p.querySelectorAll("[data-slot]").forEach(function (el) {
      el.onclick = function () { S.slot = S.slot === el.dataset.slot ? null : el.dataset.slot; S.q = ""; render(); if (S.slot) $("cb-picker").scrollIntoView({ block: "nearest", behavior: "smooth" }); };
    });
    $("cb-surprise").onclick = function () {
      var s = Blocks.surprise(S.lib.filter(function (b) { return b.visibility === "public" || b.mine; }), S.uses, S.pick);
      Object.keys(s).forEach(function (t) { S.pick[t] = s[t]; });
      S.parent = null; render();
    };
    $("cb-import").onclick = openImport;
    if ($("cb-clear")) $("cb-clear").onclick = function () { S.pick = {}; S.parent = null; render(); };
    renderPicker(); renderResult(); renderMine();
  }

  // ---------- picker ----------
  function renderPicker() {
    var box = $("cb-picker");
    if (!S.slot) { box.innerHTML = ""; return; }
    var t = Blocks.type(S.slot), q = S.q.trim().toLowerCase();
    var list = S.lib.filter(function (b) { return b.type === S.slot && b.moderation === "ok" && (b.visibility === "public" || b.mine); });
    if (!S.old) list = newest(list);
    if (q) list = list.filter(function (b) { return (b.title + " " + b.name + " " + (b.tags || []).join(" ") + " " + b.author + " " + Blocks.phrase(b)).toLowerCase().indexOf(q) > -1; });
    var u = function (b) { return S.uses[b.address] || 0; };
    list.sort(function (a, b) {
      if (S.sort === "used") return u(b) - u(a);
      if (S.sort === "new") return String(b.created_at || "").localeCompare(String(a.created_at || "")) || b.version - a.version;
      // Suggested: faces that fewer characters use come first (variety); for everything else, the most used.
      if (S.slot === "face") return (u(a) >= Blocks.POPULAR_FACE) - (u(b) >= Blocks.POPULAR_FACE) || (b.mine - a.mine) || (a.author === "Persona") - (b.author === "Persona") || u(a) - u(b);
      return (b.mine - a.mine) || u(b) - u(a);
    });
    box.innerHTML = '<div class="cb-picker"><div class="cb-picker-top"><h3>Choose a ' + t.name.toLowerCase() + ' block</h3>' +
      '<input type="text" id="cb-q" placeholder="Search ' + t.name.toLowerCase() + ' blocks" value="' + esc(S.q) + '" aria-label="Search blocks">' +
      '<select id="cb-sort" aria-label="Sort"><option value="suggested">Suggested</option><option value="used">Most used</option><option value="new">Newest</option></select>' +
      '<label class="cb-old"><input type="checkbox" id="cb-oldv"' + (S.old ? " checked" : "") + "> Older versions</label>" +
      '<button class="btn" id="cb-new">+ New ' + t.name.toLowerCase() + " block</button></div>" +
      (S.slot === "face" ? '<p class="cb-rule">Faces must be invented. Faces copied from real people or celebrities aren\'t allowed, and you can report one with the ⚑ button.</p>' : "") +
      '<div class="cb-cards">' + (list.length ? list.map(card).join("") : '<p class="empty">No blocks match. Make the first one.</p>') + "</div></div>";
    $("cb-sort").value = S.sort;
    $("cb-q").oninput = function (e) { S.q = e.target.value; var pos = e.target.selectionStart; renderPicker(); var i = $("cb-q"); i.focus(); i.setSelectionRange(pos, pos); };
    $("cb-sort").onchange = function (e) { S.sort = e.target.value; renderPicker(); };
    $("cb-oldv").onchange = function (e) { S.old = e.target.checked; renderPicker(); };
    $("cb-new").onclick = function () { openEditor({ type: S.slot }); };
    wireCards(box, list);
  }
  function card(b) {
    var n = S.uses[b.address] || 0, on = S.pick[b.type] && S.pick[b.type].address === b.address, vs = versionsOf(b);
    var popular = b.type === "face" && n >= Blocks.POPULAR_FACE;
    return '<div class="cb-card' + (on ? " on" : "") + '"><button class="cb-use" data-use="' + esc(b.address) + '" title="Use this block">' + preview(b) +
      '<b>' + esc(b.title) + "</b><code class=\"cb-addr\">" + esc(b.address) + "</code></button>" +
      '<p class="cb-phrase">' + esc(Blocks.phrase(b)) + "</p>" +
      '<div class="cb-meta">by ' + esc(b.mine ? "you" : b.author) + " · " + n + " use" + (n === 1 ? "" : "s") + (vs > 1 ? " · " + vs + " versions" : "") +
      (b.remix_of ? ' · remix of <code>' + esc(b.remix_of) + "</code>" : "") + (b.visibility === "private" ? " · private" : "") + "</div>" +
      (popular ? '<div class="sp-flag">Popular face: remix it so your character stands out.</div>' : "") +
      '<div class="cb-acts"><button class="linkbtn" data-remix="' + esc(b.address) + '">Remix</button><button class="linkbtn" data-share="' + esc(b.address) + '">Copy JSON</button>' +
      (b.mine ? '<button class="linkbtn" data-ver="' + esc(b.address) + '">New version</button>' : (b.author !== "Persona" ? '<button class="linkbtn" data-report="' + esc(b.address) + '" title="Report">⚑ Report</button>' : "")) + "</div></div>";
  }
  function wireCards(box) {
    box.querySelectorAll("[data-use]").forEach(function (el) { el.onclick = function () { var b = byAddr(el.dataset.use); S.pick[b.type] = b; S.slot = null; render(); }; });
    box.querySelectorAll("[data-remix]").forEach(function (el) { el.onclick = function () { remix(byAddr(el.dataset.remix)); }; });
    box.querySelectorAll("[data-share]").forEach(function (el) { el.onclick = function () { copy(el, JSON.stringify(Blocks.share(byAddr(el.dataset.share)), null, 2)); }; });
    box.querySelectorAll("[data-ver]").forEach(function (el) { el.onclick = function () { var b = byAddr(el.dataset.ver); openEditor(Object.assign(Blocks.share(b), { lockName: true })); }; });
    box.querySelectorAll("[data-report]").forEach(function (el) { el.onclick = function () { openReport(byAddr(el.dataset.report)); }; });
  }
  function remix(b) {
    var o = Blocks.share(b);
    openEditor({ type: o.type, title: o.title + " remix", data: JSON.parse(JSON.stringify(o.data)), preview: o.preview, tags: o.tags, remix_of: b.address, likeness: null });
  }

  // ---------- result ----------
  function renderResult() {
    var box = $("cb-result"), picked = Blocks.ORDER.filter(function (t) { return S.pick[t]; });
    if (!picked.length) { box.innerHTML = '<p class="cb-empty">Choose blocks above, or press Surprise me.</p>'; return; }
    var name = S.name || "";
    var r = Blocks.build(S.pick, S.presets, name);
    var notes = Blocks.varietyNotes(S.pick, S.uses);
    var drafts = picked.filter(function (t) { return S.pick[t].draft; });
    var models = S.presets.models || [];
    S.model = S.model || (models[0] && models[0].id);
    var compiled = Shot.compile(r.shot, S.presets, S.model, Blocks.slug(name));
    var imgs = picked.map(function (t) { return S.pick[t]; }).filter(function (b) { return b.preview; });
    box.innerHTML = '<div class="cb-result"><div class="cb-collage' + (imgs.length ? "" : " small") + '">' +
      (imgs.length ? imgs.slice(0, 6).map(function (b) { return '<figure>' + preview(b) + "<figcaption>" + esc(tname(b.type)) + "</figcaption></figure>"; }).join("")
        : picked.slice(0, 6).map(function (t) { return "<figure>" + preview(S.pick[t]) + "</figure>"; }).join("")) + "</div>" +
      '<div class="cb-out">' +
      (notes.length ? '<ul class="sp-alerts">' + notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : '<p class="sp-ok">Good mix. This combination is your own.</p>') +
      (drafts.length ? '<p class="sp-warn">These blocks were imported and aren\'t published yet: ' + drafts.map(function (t) { return "<code>" + esc(S.pick[t].address) + "</code>"; }).join(", ") +
        '. Publish them under "Your blocks" before saving, so their authors are credited.</p>' : "") +
      '<h3>Prompt</h3><div class="cb-model"><select id="cb-model" aria-label="Image tool">' + models.map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + "</option>"; }).join("") +
      '</select><button class="btn ghost" id="cb-copyp">Copy prompt</button></div><pre id="cb-prompt">' + esc(compiled.prompt) + "</pre>" +
      (compiled.negative ? '<p class="small muted">Avoid: ' + esc(compiled.negative) + "</p>" : "") +
      '<h3>Save</h3><input type="text" id="cb-name" maxlength="60" placeholder="Character name" value="' + esc(name) + '" aria-label="Character name">' +
      '<label class="rights" id="cb-rights-box"><input type="checkbox" id="cb-rights"><span>This is an AI character made from blocks. It isn\'t a real person and doesn\'t copy anyone\'s face or likeness. <a href="content-policy.html" target="_blank">Content Policy</a></span></label>' +
      '<div class="cb-save"><button class="btn" id="cb-savenew">Save as new character</button>' +
      (S.chars.length ? '<span class="cb-or">or</span><select id="cb-target" aria-label="Character">' + S.chars.map(function (c) { return '<option value="' + c.slug + '"' + (c.slug === S.current ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") +
        '</select><button class="btn ghost" id="cb-saveto">Save as new spec version</button>' : "") + "</div>" +
      '<p id="cb-msg" class="ct-msg' + (S.bad ? " err" : "") + '">' + esc(S.msg) + "</p>" +
      (S.made ? '<button class="btn ghost" id="cb-open">Open ' + esc(S.made.name) + " →</button>" : "") +
      '<h3>Share this mix</h3><div class="cb-share"><button class="btn ghost" id="cb-sjson">Copy JSON</button><button class="btn ghost" id="cb-sdl">Download .json</button><button class="btn ghost" id="cb-slink">Copy link</button></div>' +
      '<details class="cb-json"><summary>Recipe JSON</summary><pre id="cb-recipe">' + esc(recipeText()) + "</pre></details>" +
      "</div></div>";
    $("cb-model").value = S.model;
    $("cb-model").onchange = function (e) { S.model = e.target.value; renderResult(); };
    $("cb-copyp").onclick = function () { copy($("cb-copyp"), $("cb-prompt").textContent); };
    $("cb-name").oninput = function (e) { S.name = e.target.value; $("cb-recipe").textContent = recipeText(); };
    $("cb-savenew").onclick = saveNew;
    if ($("cb-open")) $("cb-open").onclick = function () { var m = S.made; S.made = null; document.dispatchEvent(new CustomEvent("persona:open-character", { detail: { slug: m.slug } })); };
    if ($("cb-saveto")) $("cb-saveto").onclick = saveTo;
    var rec = function () { return Blocks.recipe(S.name || "", S.pick, S.parent); };
    $("cb-sjson").onclick = function () { copy($("cb-sjson"), JSON.stringify(rec(), null, 2)); };
    $("cb-sdl").onclick = function () { download((Blocks.slug(S.name) || "persona-character") + ".json", rec()); };
    $("cb-slink").onclick = function () {
      var r = rec(); delete r.included;
      copy($("cb-slink"), location.origin + location.pathname + "#combo=" + encodeURIComponent(b64(r)));
    };
  }
  function recipeText() { return JSON.stringify(Blocks.recipe(S.name || "", S.pick, S.parent), function (k, v) { return k === "included" ? undefined : v; }, 2); }
  function addrs() { var o = {}; Blocks.ORDER.forEach(function (t) { if (S.pick[t]) o[t] = S.pick[t].address; }); return o; }
  function checkSave() {
    if (!Blocks.ORDER.some(function (t) { return S.pick[t]; })) { say("Pick at least one block.", true); return false; }
    if (Blocks.ORDER.some(function (t) { return S.pick[t] && S.pick[t].draft; })) { say("Publish the imported blocks first (see Your blocks below).", true); return false; }
    if (S.off) { say(SETUP, true); return false; }
    if (!$("cb-rights").checked) { var box = $("cb-rights-box"); box.classList.remove("need"); void box.offsetWidth; box.classList.add("need"); say("Tick the box to confirm your character follows the Content Policy.", true); return false; }
    return true;
  }
  function credited(r) { return r && r.credited_authors ? " " + r.credited_authors + " block author" + (r.credited_authors === 1 ? "" : "s") + " got a point." : ""; }
  function saveNew() {
    var name = ($("cb-name").value || "").trim();
    if (!name) { say("Give your character a name.", true); $("cb-name").focus(); return; }
    if (!checkSave()) return;
    var btn = $("cb-savenew"); btn.disabled = true; say("Saving…");
    var spec = Blocks.build(S.pick, S.presets, name).spec, made;
    Studio.createCharacter({ name: name, bio: "Made in Combine from " + Object.keys(addrs()).length + " blocks.", rights: true }, S.user)
      .then(function (c) { made = c; return Data.saveSpec(c.slug, spec, "Made in Combine"); })
      .then(function () { return Data.saveCombo(addrs(), name, made.slug); })
      .then(function (r) {
        S.parent = r && r.id; S.made = { slug: made.slug, name: made.name }; say("Saved " + name + " with its character spec (v1)." + credited(r));
        document.dispatchEvent(new CustomEvent("persona:character-created", { detail: { slug: made.slug } }));
      })
      .catch(function (e) { say((e && e.message) || "Couldn't save. Please try again.", true); })
      .then(function () { btn.disabled = false; });
  }
  function saveTo() {
    if (!checkSave()) return;
    var slug = $("cb-target").value, btn = $("cb-saveto"); btn.disabled = true; say("Saving…");
    var spec = Blocks.build(S.pick, S.presets, S.name).spec;
    Data.latestSpec(slug).then(function (old) {
      // Keep what blocks don't cover (world, things to avoid, reference photos).
      if (old) {
        if (old.world) spec.world = old.world;
        if (old.avoid) spec.avoid = old.avoid;
        if ((old.references || []).length) spec.references = old.references.concat(spec.references.filter(function (r) { return !old.references.some(function (o) { return o.url === r.url; }); }));
      }
      return Data.saveSpec(slug, spec, "From Combine");
    }).then(function (v) {
      return Data.saveCombo(addrs(), S.name, slug).then(function (r) { S.parent = r && r.id; say("Saved as spec version v" + v.version + ". Open the character's Shot builder to make images." + credited(r)); });
    }).catch(function (e) { say(/registry_save|character_versions|schema cache/i.test((e && e.message) || "") ? "This needs the character registry switched on first (supabase/character-registry.sql)." : ((e && e.message) || "Couldn't save."), true); })
      .then(function () { btn.disabled = false; });
  }

  // ---------- your blocks ----------
  function renderMine() {
    var box = $("cb-mine");
    var mine = newest(S.lib.filter(function (b) { return b.mine; }));
    box.innerHTML = '<div class="cb-mine"><div class="cb-mine-top"><h3>Your blocks</h3>' +
      (S.chars.length ? '<button class="btn ghost" id="cb-split">Make blocks from ' + esc((S.chars.filter(function (c) { return c.slug === S.current; })[0] || S.chars[0]).name) + "</button>" : "") +
      '<button class="btn ghost" id="cb-new2">+ New block</button></div>' +
      '<p class="sub">Publish a block to share it. Public blocks show up for everyone in Combine, and you get a point each time a new person uses one.</p>' +
      (S.drafts.length ? '<h4 class="sp-h3">Not published yet</h4><div class="cb-cards">' + S.drafts.map(function (b, i) {
        return '<div class="cb-card">' + preview(b) + "<b>" + esc(b.title) + '</b><code class="cb-addr">' + esc(tname(b.type)) + "</code>" +
          '<p class="cb-phrase">' + esc(Blocks.phrase(b)) + '</p><div class="cb-acts"><button class="linkbtn" data-dedit="' + i + '">Edit and publish</button><button class="linkbtn" data-ddel="' + i + '">Discard</button></div></div>';
      }).join("") + "</div>" : "") +
      (mine.length ? '<div class="cb-cards">' + mine.map(function (b) {
        return '<div class="cb-card">' + preview(b) + "<b>" + esc(b.title) + '</b><code class="cb-addr">' + esc(b.address) + "</code>" +
          '<div class="cb-meta">' + (S.uses[b.address] || 0) + " uses" + (b.moderation !== "ok" ? ' · <span class="sp-flag">' + (b.moderation === "removed" ? "Removed by Persona" : "Under review") + "</span>" : "") + "</div>" +
          '<label class="toggle"><input type="checkbox" data-vis="' + esc(b.address) + '"' + (b.visibility === "public" ? " checked" : "") + "> " + (b.visibility === "public" ? "Public" : "Private") + "</label>" +
          '<div class="cb-acts"><button class="linkbtn" data-ver="' + esc(b.address) + '">New version</button><button class="linkbtn" data-share="' + esc(b.address) + '">Copy JSON</button>' +
          '<button class="linkbtn" data-link="' + esc(b.address) + '">Copy link</button></div></div>';
      }).join("") + "</div>" : (S.drafts.length ? "" : '<p class="empty">No blocks yet.</p>')) + "</div>";
    if ($("cb-split")) $("cb-split").onclick = splitCharacter;
    $("cb-new2").onclick = function () { openEditor({ type: S.slot || "face" }); };
    box.querySelectorAll("[data-dedit]").forEach(function (el) { el.onclick = function () { var i = +el.dataset.dedit; openEditor(Object.assign(Blocks.share(S.drafts[i]), { draftIndex: i, likeness: null })); }; });
    box.querySelectorAll("[data-ddel]").forEach(function (el) { el.onclick = function () { S.drafts.splice(+el.dataset.ddel, 1); saveDrafts(); renderMine(); }; });
    box.querySelectorAll("[data-vis]").forEach(function (el) {
      el.onchange = function () { Data.setVisibility(byAddr(el.dataset.vis), el.checked ? "public" : "private").then(renderMine, function (e) { say(e.message, true); }); };
    });
    box.querySelectorAll("[data-link]").forEach(function (el) {
      el.onclick = function () { copy(el, location.origin + location.pathname + "#block=" + encodeURIComponent(b64(Blocks.share(byAddr(el.dataset.link))))); };
    });
    wireCards(box);
  }
  function splitCharacter() {
    var slug = S.current || (S.chars[0] && S.chars[0].slug);
    Data.latestSpec(slug).then(function (spec) {
      if (!spec) { say("Save a Character spec for this character first (character tab → Character spec).", true); renderResult(); return; }
      var made = Blocks.fromSpec(spec, slug), ref = (spec.references || []).filter(function (r) { return /^https:\/\//.test(r.url || ""); })[0];
      var img = S.images.filter(function (u) { return u.slug === slug; })[0];
      made.forEach(function (b) { b.preview = (ref && ref.url) || (img && img.src) || null; b.draft = true; b.author = (S.user && S.user.name) || "You"; });
      S.drafts = S.drafts.concat(made); saveDrafts(); renderMine();
      $("cb-mine").scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  // ---------- block editor ----------
  function dialog(html) {
    var d = $("cb-dialog");
    if (!d) { d = document.createElement("dialog"); d.id = "cb-dialog"; d.className = "cb-dialog"; document.body.appendChild(d); }
    d.innerHTML = html; if (!d.open) d.showModal(); return d;
  }
  function openEditor(o) {
    o = o || {}; var t = Blocks.type(o.type) || TYPES[0], data = o.data || {};
    var pics = S.images.filter(function (im) { return /^(https:\/\/|images\/)/.test(im.src || ""); }).slice(0, 24);
    var d = dialog('<form class="ct cb-ed" method="dialog" id="cb-ed"><div class="cb-ed-top"><h2>' + (o.lockName ? "New version of " + esc(o.type + "@" + o.name) : o.remix_of ? "Remix " + esc(o.remix_of) : "New block") + '</h2><button type="button" class="linkbtn" id="cb-ed-x">Close</button></div>' +
      '<div class="ct-grid2"><label class="ct-field"><span>Type</span><select id="cb-ed-type"' + (o.lockName ? " disabled" : "") + ">" + TYPES.map(function (x) { return '<option value="' + x.id + '"' + (x.id === t.id ? " selected" : "") + ">" + x.name + "</option>"; }).join("") + "</select></label>" +
      '<label class="ct-field"><span>Title</span><input type="text" id="cb-ed-title" maxlength="60" value="' + esc(o.title || "") + '" placeholder="e.g. Sienna"></label></div>' +
      '<label class="ct-field"><span>Name (part of the address)</span><input type="text" id="cb-ed-name" maxlength="40" value="' + esc(o.lockName ? o.name : "") + '" placeholder="e.g. sienna"' + (o.lockName ? " disabled" : "") + '><small class="muted" id="cb-ed-addr"></small></label>' +
      '<div id="cb-ed-fields"></div>' +
      '<div class="ct-field"><span>Preview image</span>' + (pics.length ? '<div class="sp-pick" id="cb-ed-pics">' + pics.map(function (im) {
        return '<button type="button" class="sp-pickbtn' + (o.preview === im.src ? " on" : "") + '" data-src="' + esc(im.src) + '">' + '<span class="sp-th"><img src="' + esc(im.src) + '" alt=""></span></button>';
      }).join("") + "</div>" : "") + '<input type="text" id="cb-ed-prev" value="' + esc(o.preview || "") + '" placeholder="or paste an https:// image link"></div>' +
      '<label class="ct-field"><span>Tags</span><input type="text" id="cb-ed-tags" value="' + esc((o.tags || []).join(", ")) + '" placeholder="up to 8 words, comma separated"></label>' +
      '<label class="rights" id="cb-ed-like-box"' + (t.id === "face" ? "" : " hidden") + '><input type="checkbox" id="cb-ed-like"><span>' + esc(Blocks.LIKENESS_TEXT) + "</span></label>" +
      '<div class="cb-save"><button class="btn" type="button" id="cb-ed-pub">Publish</button><button class="btn ghost" type="button" id="cb-ed-priv">Save as private</button><button class="btn ghost" type="button" id="cb-ed-use">Just use it here</button></div>' +
      '<p class="ct-msg" id="cb-ed-msg"></p></form>');
    function fields(tid) {
      var tt = Blocks.type(tid);
      $("cb-ed-fields").innerHTML = '<p class="sub">' + esc(tt.hint) + '</p><div class="ct-grid2">' + tt.fields.map(function (f) {
        var v = data[f[0]];
        if (f[3] === "bool") return '<label class="cb-bool"><input type="checkbox" data-f="' + f[0] + '" data-kind="bool"' + (v ? " checked" : "") + "> " + esc(f[1]) + "</label>";
        if (f[3] === "area") return '<label class="ct-field wide"><span>' + esc(f[1]) + '</span><textarea data-f="' + f[0] + '" rows="2" placeholder="' + esc(f[2]) + '">' + esc(v || "") + "</textarea></label>";
        return '<label class="ct-field"><span>' + esc(f[1]) + '</span><input type="text" data-f="' + f[0] + '"' + (f[3] === "list" ? ' data-kind="list"' : "") + ' value="' + esc(Array.isArray(v) ? v.join(", ") : v || "") + '" placeholder="' + esc(f[2]) + '"></label>';
      }).join("") + "</div>";
      $("cb-ed-like-box").hidden = tid !== "face";
    }
    function addr() {
      var n = o.lockName ? o.name : Blocks.slug($("cb-ed-name").value || $("cb-ed-title").value);
      $("cb-ed-addr").textContent = n ? "Address: " + $("cb-ed-type").value + "@" + n + "/v…" : "";
    }
    function read() {
      var dd = {};
      d.querySelectorAll("[data-f]").forEach(function (el) { dd[el.dataset.f] = el.dataset.kind === "bool" ? el.checked : el.value; });
      if (data.preset) dd.preset = data.preset;
      return Blocks.validate({ type: $("cb-ed-type").value, name: o.lockName ? o.name : ($("cb-ed-name").value || $("cb-ed-title").value), title: $("cb-ed-title").value,
        data: dd, preview: $("cb-ed-prev").value.trim(), tags: $("cb-ed-tags").value, remix_of: o.lockName ? null : o.remix_of,
        likeness: $("cb-ed-like").checked ? "invented" : null, author: (S.user && S.user.name) || "You" });
    }
    function msg(t, bad) { var m = $("cb-ed-msg"); m.textContent = t; m.className = "ct-msg" + (bad ? " err" : ""); }
    fields(t.id); addr();
    $("cb-ed-type").onchange = function (e) { data = {}; fields(e.target.value); addr(); };
    $("cb-ed-name").oninput = addr; $("cb-ed-title").oninput = addr;
    $("cb-ed-x").onclick = function () { d.close(); };
    d.querySelectorAll("[data-src]").forEach(function (b) {
      b.onclick = function () { d.querySelectorAll("[data-src]").forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on"); $("cb-ed-prev").value = b.dataset.src; };
    });
    function done(b) {
      if (o.draftIndex !== undefined) { S.drafts.splice(o.draftIndex, 1); saveDrafts(); }
      S.pick[b.type] = b; S.slot = null; d.close(); render();
    }
    function publish(vis) {
      var b;
      try { b = read(); } catch (e) { msg(e.message, true); return; }
      if (b.type === "face" && b.likeness !== "invented") { var box = $("cb-ed-like-box"); box.classList.remove("need"); void box.offsetWidth; box.classList.add("need"); msg("Tick the box to confirm this face is invented.", true); return; }
      if (S.off) { msg(SETUP, true); return; }
      if (!b.preview && vis === "public") msg("Tip: blocks with a preview image get used much more.");
      Data.publish(b, vis).then(function (saved) { done(saved); say("Published " + saved.address + "."); renderResult(); }, function (e) { msg((e && e.message) || "Couldn't publish.", true); });
    }
    $("cb-ed-pub").onclick = function () { publish("public"); };
    $("cb-ed-priv").onclick = function () { publish("private"); };
    $("cb-ed-use").onclick = function () {
      var b; try { b = read(); } catch (e) { msg(e.message, true); return; }
      b.draft = true; if (o.draftIndex === undefined) { S.drafts.push(b); saveDrafts(); } else { S.drafts[o.draftIndex] = b; saveDrafts(); o.draftIndex = undefined; }
      done(b);
    };
  }

  // ---------- import, report ----------
  function openImport() {
    var d = dialog('<form class="ct cb-ed" method="dialog"><div class="cb-ed-top"><h2>Import JSON</h2><button type="button" class="linkbtn" id="cb-im-x">Close</button></div>' +
      '<p class="sub">Paste a block, a list of blocks, or a character recipe someone shared with you. Or choose a .json file.</p>' +
      '<textarea id="cb-im-text" rows="10" placeholder="{ &quot;persona_block&quot;: 1, ... }"></textarea>' +
      '<div class="cb-save"><button class="btn" type="button" id="cb-im-go">Import</button><label class="btn ghost">Choose file<input type="file" id="cb-im-file" accept="application/json,.json" hidden></label></div>' +
      '<p class="ct-msg" id="cb-im-msg"></p></form>');
    $("cb-im-x").onclick = function () { d.close(); };
    $("cb-im-file").onchange = function (e) { var f = e.target.files[0]; if (f) f.text().then(function (t) { $("cb-im-text").value = t; }); };
    $("cb-im-go").onclick = function () {
      try { importShared($("cb-im-text").value); d.close(); }
      catch (e) { $("cb-im-msg").textContent = e.message || "That JSON couldn't be read."; $("cb-im-msg").className = "ct-msg err"; }
    };
  }
  // Known addresses use the library copy (so authors get credit). Unknown ones come in as drafts you can publish.
  function adopt(b) {
    var known = byAddr(b.address);
    if (known && !known.draft) return known;
    if (known) return known;
    b.draft = true; S.drafts.push(b); saveDrafts(); return b;
  }
  function importShared(text) {
    var r = Blocks.parseShared(text);
    if (r.kind === "block") { var b = adopt(r.block); S.pick[b.type] = b; say("Imported " + b.address + "."); }
    else if (r.kind === "blocks") { r.blocks.forEach(function (x) { var b = adopt(x); S.pick[b.type] = b; }); say("Imported " + r.blocks.length + " blocks."); }
    else {
      var inc = {}; r.included.forEach(function (x) { inc[x.address] = x; });
      Object.keys(r.blocks).forEach(function (t) {
        var a = r.blocks[t], b = byAddr(a) || (inc[a] && adopt(inc[a]));
        if (b) S.pick[t] = b;
      });
      S.name = r.name || ""; S.parent = r.remix_of || null;
      say("Loaded " + (r.name || "the character") + ". Change any block to make your own version.");
    }
    S.slot = null; render();
  }
  function openReport(b) {
    var d = dialog('<form class="ct cb-ed" method="dialog"><div class="cb-ed-top"><h2>Report ' + esc(b.address) + '</h2><button type="button" class="linkbtn" id="cb-rp-x">Close</button></div>' +
      '<label class="ct-field"><span>Why</span><select id="cb-rp-why">' + REASONS.map(function (r) { return '<option value="' + r[0] + '">' + esc(r[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="ct-field"><span>Details (optional)</span><textarea id="cb-rp-det" maxlength="1000" placeholder="e.g. who it copies"></textarea></label>' +
      '<div class="cb-save"><button class="btn" type="button" id="cb-rp-go">Send report</button></div><p class="ct-msg" id="cb-rp-msg"></p></form>');
    $("cb-rp-x").onclick = function () { d.close(); };
    $("cb-rp-go").onclick = function () {
      Data.report(b, $("cb-rp-why").value, $("cb-rp-det").value).then(function () {
        $("cb-rp-msg").textContent = "Thanks. Persona reviews reported blocks, and 3 reports hide a block until then."; $("cb-rp-go").disabled = true;
      }, function (e) { $("cb-rp-msg").textContent = e.message; $("cb-rp-msg").className = "ct-msg err"; });
    };
  }

  // ---------- public ----------
  window.StudioBlocks = {
    // opts: { user, chars: [{slug, name}], current }
    open: function (opts) {
      opts = opts || {};
      S.user = opts.user || S.user; S.chars = opts.chars || []; S.current = opts.current || null;
      $("cb-panel").hidden = false;
      if (!S.ready) S.ready = Data.load();
      // Images from the creator's characters, offered as block previews.
      Promise.all(S.chars.map(function (c) {
        var ch = (window.CHARACTERS || []).filter(function (x) { return x.slug === c.slug; })[0];
        return ch ? Studio.all(ch).then(function (l) { return l.map(function (im) { return { slug: c.slug, src: im.src }; }); }, function () { return []; }) : [];
      })).then(function (r) { S.images = [].concat.apply([], r); });
      return S.ready.then(function () {
        var m = /#(block|combo)=([^&]+)/.exec(location.hash);
        if (m) {
          history.replaceState(null, "", location.pathname + location.search);
          try { importShared(JSON.stringify(unb64(decodeURIComponent(m[2])))); return; } catch (e) { say("That shared link couldn't be read.", true); }
        }
        render();
      });
    },
    close: function () { var p = $("cb-panel"); if (p) p.hidden = true; var d = $("cb-dialog"); if (d && d.open) d.close(); },
    hasLink: function () { return /#(block|combo)=/.test(location.hash); },
  };
})();
