// Persona shot engine: builds on-model image prompts from a character spec + camera/scene presets,
// and runs the drift guard's variety checks. Plain JS, used by Studio (browser) and the API (Node).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Shot = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var GROUPS = ["camera", "lighting", "location", "pose"];

  function list(v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
    return String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function find(presets, group, id) {
    return (presets[group] || []).filter(function (p) { return p.id === id; })[0] || null;
  }
  function fill(text, spec) {
    var w = (spec && spec.world) || {};
    return String(text)
      .replace(/\{home_city\}/g, w.home_city || "their home city")
      .replace(/\{hobby\}/g, w.hobby || "a favourite hobby");
  }
  function recipeKey(r) { return r ? GROUPS.map(function (g) { return r[g] || "-"; }).join("|") : ""; }

  // The one sentence that is pasted into every prompt, so the face never changes.
  function identitySentence(spec) {
    var id = (spec && spec.identity) || {};
    if (id.sentence && String(id.sentence).trim()) return String(id.sentence).trim().replace(/\.$/, "");
    var bits = [id.age_range, id.face, id.eyes, id.skin, id.hair, id.signature_detail].map(function (x) { return String(x || "").trim(); }).filter(Boolean);
    return bits.length ? "a person, " + bits.join(", ") : "";
  }

  // choice: { camera, lighting, location, pose, outfit, extra } (ids from presets.json)
  function build(spec, presets, choice, version) {
    spec = spec || {}; choice = choice || {};
    var id = spec.identity || {}, style = spec.style || {};
    var picked = {}, parts = [];
    GROUPS.forEach(function (g) { picked[g] = choice[g] ? find(presets, g, choice[g]) : null; });
    var who = identitySentence(spec);
    var lead = who ? "Photo of " + who : "Photo of the character";
    if (id.body) { var b = String(id.body).trim(); lead += ", " + b.charAt(0).toLowerCase() + b.slice(1); }
    parts.push(lead);
    var outfit = String(choice.outfit || "").trim() || (list(style.outfit_staples).length ? list(style.outfit_staples).join(", ") : "");
    if (outfit) parts.push("wearing " + outfit);
    GROUPS.forEach(function (g) { if (picked[g]) parts.push(fill(picked[g].prompt, spec)); });
    if (list(style.keywords).length) parts.push("style: " + list(style.keywords).join(", "));
    if (list(style.palette).length) parts.push("colour palette: " + list(style.palette).join(", "));
    if (choice.extra) parts.push(String(choice.extra).trim());
    var always = (presets.always && presets.always.add) || [];
    parts = parts.concat(always);
    var keep = list(id.never_change);
    var prompt = parts.join(", ") + "." + (keep.length ? " Keep exactly the same as the reference images: " + keep.join(", ") + "." : "");
    var avoid = list((presets.always && presets.always.avoid) || []).concat(list(spec.avoid));
    var recipe = { camera: choice.camera || null, lighting: choice.lighting || null, location: choice.location || null, pose: choice.pose || null };
    if (version) recipe.spec_version = version;
    return {
      prompt: prompt,
      negative: avoid.filter(function (x, i) { return avoid.indexOf(x) === i; }).join(", "),
      identity_sentence: who,
      recipe: recipe,
      labels: GROUPS.reduce(function (o, g) { o[g] = picked[g] ? picked[g].name : null; return o; }, {}),
      references: (spec.references || []).map(function (r) { return r.url; }).filter(function (u) { return /^https?:\/\//.test(u || ""); }),
      settings: presets.settings || {},
    };
  }

  function counts(presets, recipes) {
    var c = {};
    GROUPS.forEach(function (g) {
      c[g] = {};
      (presets[g] || []).forEach(function (p) { c[g][p.id] = 0; });
      recipes.forEach(function (r) { if (r && r[g] && c[g][r[g]] !== undefined) c[g][r[g]]++; });
    });
    return c;
  }
  function leastUsed(presets, cnt, g, avoid, n) {
    return (presets[g] || []).slice().sort(function (a, b) {
      return (cnt[g][a.id] - cnt[g][b.id]) || ((a.id === avoid) - (b.id === avoid));
    }).filter(function (p) { return p.id !== avoid; }).slice(0, n || 3);
  }

  // recent: recipes of the character's latest images, newest first. choice: optional shot about to be made.
  function variety(presets, recent, choice) {
    var rules = presets.variety_rules || {};
    var win = rules.recent_window || 12;
    var recipes = (recent || []).filter(Boolean).slice(0, win);
    var cnt = counts(presets, recipes), warnings = [];
    function name(g, id) { var p = find(presets, g, id); return p ? p.name : id; }
    function over(g, max, label) {
      Object.keys(cnt[g]).forEach(function (id) {
        if (cnt[g][id] > max) warnings.push({ code: "repeat_" + g, group: g, preset: id,
          message: "“" + name(g, id) + "” " + label + " in " + cnt[g][id] + " of your last " + recipes.length + " images." });
      });
    }
    if (recipes.length >= 3) {
      over("camera", rules.max_same_camera || 4, "camera was used");
      over("location", rules.max_same_location || 3, "location was used");
      var seen = {};
      recipes.forEach(function (r) { var k = recipeKey(r); seen[k] = (seen[k] || 0) + 1; });
      Object.keys(seen).forEach(function (k) {
        if (seen[k] > (rules.max_same_recipe || 1) && k.replace(/[-|]/g, ""))
          warnings.push({ code: "repeat_recipe", message: seen[k] + " images use exactly the same set-up (" + k.split("|").map(function (id, i) { return id === "-" ? null : name(GROUPS[i], id); }).filter(Boolean).join(" · ") + ")." });
      });
      var withCam = recipes.filter(function (r) { return r.camera; });
      var shop = withCam.filter(function (r) { var p = find(presets, "camera", r.camera); return p && p.shop; }).length;
      if (withCam.length >= 4 && shop / withCam.length < (rules.min_shop_ready_share || 0.6))
        warnings.push({ code: "low_shop", message: "Only " + shop + " of " + withCam.length + " recent images show the full outfit, so Shop the look has less to match." });
    }
    var check = [];
    if (choice) {
      var k = recipeKey(choice);
      if (recipes.some(function (r) { return recipeKey(r) === k; }) && k.replace(/[-|]/g, "")) check.push("You already made an image with exactly this set-up. Change at least one preset.");
      ["camera", "location"].forEach(function (g) {
        var max = g === "camera" ? (rules.max_same_camera || 4) : (rules.max_same_location || 3);
        if (choice[g] && cnt[g][choice[g]] >= max) check.push("“" + name(g, choice[g]) + "” is already in " + cnt[g][choice[g]] + " recent images.");
      });
    }
    var last = recipes[0] || {};
    var suggest = {};
    GROUPS.forEach(function (g) { suggest[g] = leastUsed(presets, cnt, g, last[g], 3).map(function (p) { return { id: p.id, name: p.name }; }); });
    var score = recipes.length < 3 ? null : Math.max(0, 100 - warnings.length * 18);
    return {
      images_checked: recipes.length,
      score: score,
      verdict: score === null ? "Not enough tagged images yet" : score >= 80 ? "Good variety" : score >= 50 ? "Getting repetitive" : "Repetitive",
      warnings: warnings,
      choice_warnings: check,
      try_next: suggest,
      usage: cnt,
    };
  }

  // A fresh shot: least-used preset in each group, never the same as the last image.
  function surprise(presets, recent, rnd) {
    rnd = rnd || Math.random;
    var recipes = (recent || []).filter(Boolean).slice(0, (presets.variety_rules || {}).recent_window || 12);
    var cnt = counts(presets, recipes), last = recipes[0] || {}, out = {};
    GROUPS.forEach(function (g) {
      var opts = leastUsed(presets, cnt, g, last[g], 99);
      if (g === "camera" && rnd() < 0.75) { var shop = opts.filter(function (p) { return p.shop; }); if (shop.length) opts = shop; }
      var min = opts.length ? cnt[g][opts[0].id] : 0;
      var pool = opts.filter(function (p) { return cnt[g][p.id] === min; });
      if (pool.length) out[g] = pool[Math.floor(rnd() * pool.length)].id;
    });
    return out;
  }

  // Perceptual hashes (64-bit hex) from Studio. Small distance = nearly the same picture.
  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return 64;
    var d = 0;
    for (var i = 0; i < a.length; i++) {
      var x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      while (x) { d += x & 1; x >>= 1; }
    }
    return d;
  }
  function duplicates(images, threshold) {
    threshold = threshold || 10;
    var out = [];
    for (var i = 0; i < images.length; i++) for (var j = i + 1; j < images.length; j++) {
      var d = hamming(images[i].phash, images[j].phash);
      if (d <= threshold) out.push({ a: images[i].id, b: images[j].id, distance: d, level: d <= 5 ? "almost identical" : "very similar" });
    }
    return out;
  }

  // Same face: creator confirmations first, then the AI tool's own self-check (1 to 5 per trait).
  function faceReport(images) {
    var yes = 0, no = 0, aiFlag = [], unchecked = 0;
    images.forEach(function (im) {
      if (im.on_model === "yes") yes++;
      else if (im.on_model === "no") no++;
      else {
        unchecked++;
        var c = im.ai_check;
        if (c && (["face", "hair", "signature"].some(function (k) { return c[k] !== undefined && Number(c[k]) < 4; }) ||
          (c.face_score !== undefined && c.face_score !== null && Number(c.face_score) < 70))) aiFlag.push(im.id);
      }
    });
    return { confirmed_on_model: yes, off_model: no, unchecked: unchecked, ai_flagged: aiFlag,
      share: yes + no ? Math.round(100 * yes / (yes + no)) : null };
  }


  // ---------- prompt compiler: one shot -> the right prompt format for each image model ----------
  function compile(shot, presets, modelId, slug) {
    var m = (presets.models || []).filter(function (x) { return x.id === modelId; })[0] || (presets.models || [])[0];
    if (!m) return { model: modelId, prompt: shot.prompt, negative: shot.negative };
    var refs = shot.references || [], base = shot.prompt, neg = shot.negative;
    var p = JSON.parse(JSON.stringify(m.params || {})), out = { model: m.id, model_name: m.name, credits: m.credits };
    if (m.id === "gpt-image") {
      out.prompt = (refs.length ? "Use the attached reference images: this is the same person, keep their face, hair and signature detail identical. " : "") + base + " Avoid: " + neg + ".";
    } else if (m.id === "gemini-image") {
      out.prompt = (refs.length ? "Using the attached reference photos of this exact person, create a new photo. Do not change their face, hair or signature detail. " : "") + base + " Do not include: " + neg + ".";
    } else if (m.id === "flux") {
      // Flux has no negative prompt, so the "avoid" list becomes a positive instruction.
      out.prompt = (refs.length ? "Same person as the reference image. " : "") + base + " Clean photo with no text, logos or watermarks, natural hands.";
      if (refs.length) p.input_image = refs[0];
    } else if (m.id === "midjourney") {
      var mj = base.replace(/\. Keep exactly the same as the reference images: /, ", same person: ").replace(/\.$/, "");
      out.prompt = mj + " --ar " + p.ar + " --style " + p.style + " --no " + neg.split(", ").slice(0, 8).join(", ") + (refs.length ? " --oref " + refs[0] + " --ow 100" : "");
      p = {};
    } else if (m.id === "sdxl-lora") {
      out.prompt = "<lora:" + (slug || "character") + ":0.8>, " + base;
      out.negative = neg;
    }
    if (m.negative && m.id !== "midjourney" && !out.negative) out.negative = neg;
    out.params = p;
    if (refs.length && m.refs) out.attach = refs;
    return out;
  }

  // ---------- model router: best model for this shot, weighing cost ----------
  // opts: { budget: "low" | "balanced" | "best", has_lora: bool }
  function route(shot, presets, opts) {
    opts = opts || {};
    var models = presets.models || [], refs = (shot.references || []).length, r = shot.recipe || {};
    var cam = r.camera ? find(presets, "camera", r.camera) : null;
    var portrait = r.camera === "cam-85-portrait", detail = r.camera === "cam-detail";
    var night = /light-(neon|flash-night|blue-hour)/.test(r.lighting || "");
    var scored = models.map(function (m) {
      var s = 50, why = [];
      if (refs && m.refs) { s += 20; why.push("can use your reference images"); }
      if (!refs && m.id === "gemini-image") s -= 10;
      if (m.id === "gemini-image" && refs) { s += 10; why.push("strongest at keeping the same face"); }
      if (m.id === "gpt-image") { s += 8; why.push("follows long prompts closely"); }
      if (m.id === "midjourney" && (portrait || night)) { s += 12; why.push("best for editorial mood and lighting"); }
      if (m.id === "flux" && (detail || (cam && cam.shop))) { s += 8; why.push("sharp, realistic clothes"); }
      if (m.id === "sdxl-lora") { if (opts.has_lora) { s += 15; why.push("uses your trained LoRA"); } else s -= 40; }
      var costW = opts.budget === "low" ? 12 : opts.budget === "best" ? 0 : 5;
      s -= (m.credits - 1) * costW;
      if (opts.budget === "low" && m.credits === 1) why.push("lowest cost");
      return { id: m.id, name: m.name, credits: m.credits, score: s, why: why };
    }).sort(function (a, b) { return b.score - a.score; });
    var best = scored[0];
    return { pick: best && { id: best.id, name: best.name, credits: best.credits, reason: best.why.join(", ") || "good all-rounder" },
      alternatives: scored.slice(1, 3).map(function (x) { return { id: x.id, name: x.name, credits: x.credits }; }),
      note: presets.models_note };
  }

  // ---------- recipes: each image's set-up as shareable, forkable JSON ----------
  function toRecipe(slug, version, choice, model, products) {
    var r = { persona_recipe: 1, character: slug || null, spec_version: version || null };
    GROUPS.forEach(function (g) { r[g] = choice[g] || null; });
    if (choice.outfit) r.outfit = choice.outfit;
    if (products && products.length) r.products = products;
    if (model) r.model = model;
    return r;
  }
  function parseRecipe(text) {
    var o = typeof text === "string" ? JSON.parse(text) : text;
    if (!o || typeof o !== "object") throw new Error("That isn't a recipe.");
    var src = o.recipe && typeof o.recipe === "object" ? Object.assign({}, o, o.recipe) : o;
    var out = {}, any = false;
    GROUPS.forEach(function (g) { if (src[g]) { out[g] = String(src[g]); any = true; } });
    if (src.outfit) out.outfit = String(src.outfit).slice(0, 200);
    if (Array.isArray(src.products)) out.products = src.products.slice(0, 8).map(String);
    if (src.model) out.model = String(src.model);
    if (!any) throw new Error("No camera, lighting, location or pose found in that recipe.");
    return out;
  }

  return { compile: compile, route: route, toRecipe: toRecipe, parseRecipe: parseRecipe, GROUPS: GROUPS, build: build, variety: variety, surprise: surprise, identitySentence: identitySentence,
    hamming: hamming, duplicates: duplicates, faceReport: faceReport, recipeKey: recipeKey, find: find };
});
