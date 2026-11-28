// Persona character blocks: small typed JSON pieces (face, body, hair, wardrobe, camera, light, location, mood, pose)
// that anyone can share and combine into new characters. A character is a recipe that points to blocks by address,
// e.g. face@sienna/v2 + mood@noir/v1, so remixes keep their family tree.
// Plain JS, used by Studio (browser) and Node (tests, scripts). Builds prompts through lib/shot.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./shot.js"));
  else root.Blocks = factory(root.Shot);
})(typeof self !== "undefined" ? self : this, function (Shot) {
  "use strict";

  // kind: text (one line), area (a few lines), list (comma separated), bool
  var TYPES = [
    { id: "face", name: "Face", hint: "Face shape, eyes, skin and the detail people recognise", fields: [
      ["age_range", "Age range", "e.g. mid 20s"], ["face", "Face", "Shape and features", "area"], ["eyes", "Eyes", "Colour and shape"],
      ["skin", "Skin", "Tone, freckles, marks"], ["signature_detail", "Signature detail", "e.g. a small scar through the left eyebrow"],
      ["never_change", "Never change", "Comma separated, e.g. freckles, gap in front teeth", "list"]] },
    { id: "body", name: "Body", hint: "Height and build", fields: [
      ["build", "Build", "e.g. slim, athletic, soft curves"], ["height", "Height", "e.g. tall, about 178 cm"], ["details", "Details", "e.g. long legs, tattoo on the right forearm", "area"]] },
    { id: "hair", name: "Hair", hint: "Colour, length and cut", fields: [
      ["colour", "Colour", "e.g. pastel pink"], ["length", "Length", "e.g. chin length"], ["cut", "Cut", "e.g. blunt bob with a fringe"], ["texture", "Texture", "e.g. glossy and straight"]] },
    { id: "wardrobe", name: "Wardrobe", hint: "What they wear", fields: [
      ["outfit", "Outfit", "e.g. oversized black blazer, white tee, straight jeans, loafers", "area"],
      ["style", "Style words", "e.g. minimal, monochrome", "list"], ["palette", "Colours", "e.g. black, cream, chrome", "list"]] },
    { id: "camera", name: "Camera", hint: "Lens, framing and angle", shot: "camera", fields: [
      ["description", "Camera", "e.g. full-body shot on a 35mm lens at eye level", "area"], ["full_outfit", "Shows the whole outfit", "", "bool"]] },
    { id: "light", name: "Light", hint: "Time of day and light", shot: "lighting", fields: [["description", "Light", "e.g. warm golden-hour sun from the side", "area"]] },
    { id: "location", name: "Location", hint: "Where the photo is", shot: "location", fields: [["description", "Location", "e.g. a quiet Paris side street with cafe tables", "area"]] },
    { id: "mood", name: "Mood", hint: "Feeling, expression and colour grade", fields: [
      ["feeling", "Feeling", "e.g. moody and mysterious"], ["expression", "Expression", "e.g. a slight, knowing smile"],
      ["grade", "Colour grade", "e.g. deep shadows, muted greens, film grain"], ["keywords", "Mood words", "e.g. noir, cinematic", "list"]] },
    { id: "pose", name: "Pose", hint: "What they're doing", shot: "pose", fields: [["description", "Pose", "e.g. walking toward the camera mid-stride", "area"]] },
  ];
  var ORDER = TYPES.map(function (t) { return t.id; });
  var NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var ADDR_RE = /^(face|body|hair|wardrobe|camera|light|location|mood|pose)@([a-z0-9]+(?:-[a-z0-9]+)*)\/v([1-9][0-9]{0,3})$/;
  var LIKENESS_TEXT = "This face is invented. It isn't copied from a real person, a celebrity or a photo of someone, and it isn't made to look like anyone real.";

  function type(id) { return TYPES.filter(function (t) { return t.id === id; })[0] || null; }
  function slug(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  }
  function address(b) { return b.type + "@" + b.name + "/v" + (b.version || 1); }
  function parse(addr) {
    var m = ADDR_RE.exec(String(addr || "").trim());
    return m ? { type: m[1], name: m[2], version: +m[3], address: m[0] } : null;
  }
  function list(v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
    return String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function str(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
  function okUrl(u) { return /^https:\/\/[^\s"'<>]+$/.test(u || "") || /^images\/[a-z0-9._-]+$/i.test(u || ""); }

  // Cleans a block someone typed, pasted or imported. Throws a plain-language error if it can't be used.
  function validate(input) {
    var o = typeof input === "string" ? JSON.parse(input) : input;
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("That isn't a block.");
    var p = o.address ? parse(o.address) : null;
    var t = type(o.type || (p && p.type));
    if (!t) throw new Error("A block needs a type: " + ORDER.join(", ") + ".");
    var name = slug(o.name || (p && p.name) || o.title);
    if (!NAME_RE.test(name)) throw new Error("Give the block a short name, like sienna or golden-hour.");
    var version = Math.max(1, Math.min(9999, parseInt(o.version || (p && p.version) || 1, 10) || 1));
    var src = o.data && typeof o.data === "object" ? o.data : {}, data = {}, any = false;
    t.fields.forEach(function (f) {
      var v = src[f[0]];
      if (f[3] === "list") { v = list(v).slice(0, 12).map(function (x) { return x.slice(0, 60); }); if (v.length) { data[f[0]] = v; any = true; } }
      else if (f[3] === "bool") { if (v === true || v === "true") data[f[0]] = true; }
      else { v = str(v, f[3] === "area" ? 400 : 120); if (v) { data[f[0]] = v; any = true; } }
    });
    if (src.preset && /^[a-z0-9-]{2,40}$/.test(src.preset)) data.preset = src.preset;
    if (!any) throw new Error("Fill in at least one detail for this " + t.name.toLowerCase() + " block.");
    var b = {
      persona_block: 1, type: t.id, name: name, version: version, title: str(o.title, 60) || name,
      author: str(o.author || o.author_name, 80) || null,
      preview: okUrl(o.preview || o.preview_url) ? (o.preview || o.preview_url) : null,
      data: data,
      remix_of: parse(o.remix_of) ? parse(o.remix_of).address : null,
      tags: list(o.tags).slice(0, 8).map(function (x) { return slug(x).slice(0, 24); }).filter(Boolean),
    };
    if (t.id === "face") b.likeness = o.likeness === "invented" ? "invented" : null;
    b.address = address(b);
    return b;
  }

  // The words a block adds to a prompt (also shown under each block card).
  function phrase(b) {
    var d = (b && b.data) || {};
    switch (b && b.type) {
      case "face": return [d.age_range, d.face, d.eyes && d.eyes + (/eye/i.test(d.eyes) ? "" : " eyes"), d.skin, d.signature_detail].filter(Boolean).join(", ");
      case "body": return [d.height, d.build, d.details].filter(Boolean).join(", ");
      case "hair": return hairText(d);
      case "wardrobe": return [d.outfit, list(d.style).join(", ")].filter(Boolean).join("; ");
      case "mood": return moodText(d);
      default: return d.description || "";
    }
  }
  function hairText(d) {
    var main = [d.colour, d.length, d.cut].filter(Boolean).join(" ");
    var t = [main, d.texture].filter(Boolean).join(", ");
    return t ? t + (/hair/i.test(t) ? "" : " hair") : "";
  }
  function moodText(d) {
    var bits = [d.feeling && d.feeling + " mood", d.expression, d.grade].filter(Boolean);
    return bits.join(", ");
  }

  // byType: { face: block, hair: block, ... } (any may be missing). Returns a registry spec and a shot choice.
  function combine(byType, presets, name) {
    byType = byType || {}; presets = presets || {};
    var f = (byType.face || {}).data || {}, h = (byType.hair || {}).data, bo = byType.body, w = (byType.wardrobe || {}).data || {}, m = (byType.mood || {}).data || {};
    var identity = {};
    ["age_range", "face", "eyes", "skin", "signature_detail"].forEach(function (k) { if (f[k]) identity[k] = f[k]; });
    if (identity.eyes && !/eye/i.test(identity.eyes)) identity.eyes += " eyes";
    if (h) identity.hair = hairText(h);
    if (bo) identity.body = phrase(bo);
    var keep = list(f.never_change);
    if (h && h.colour) keep.push(h.colour + " hair");
    if (keep.length) identity.never_change = keep.filter(function (x, i) { return keep.indexOf(x) === i; });
    var style = {};
    if (w.outfit) style.outfit_staples = [w.outfit];
    if (list(w.palette).length) style.palette = list(w.palette);
    var kw = list(w.style).concat(list(m.keywords));
    if (kw.length) style.keywords = kw.filter(function (x, i) { return kw.indexOf(x) === i; });
    var spec = { identity: identity, style: style, blocks: {}, references: [] };
    if (name) spec.name = name;
    ORDER.forEach(function (t) { if (byType[t]) spec.blocks[t] = byType[t].address; });
    ["face", "body"].forEach(function (t) {
      var b = byType[t];
      if (b && /^https:\/\//.test(b.preview || "")) spec.references.push({ url: b.preview, role: t === "face" ? "face" : "full body", block: b.address });
    });

    // Shot: camera/light/location/pose blocks become presets. Starter blocks keep their preset id so the drift guard counts them.
    var shotPresets = Object.assign({}, presets), choice = {};
    TYPES.forEach(function (t) {
      if (!t.shot) return;
      var b = byType[t.id];
      shotPresets[t.shot] = (presets[t.shot] || []).slice();
      if (!b) return;
      var id = (b.data && b.data.preset) || b.address;
      if (!Shot.find(shotPresets, t.shot, id)) shotPresets[t.shot].push({ id: id, name: b.title, prompt: b.data.description || "", shop: !!b.data.full_outfit });
      choice[t.shot] = id;
    });
    if (w.outfit) choice.outfit = w.outfit;
    var mt = moodText(m);
    if (mt) choice.extra = mt;
    return { spec: spec, choice: choice, presets: shotPresets };
  }

  // Full preview: prompt + recipe for the combined character.
  function build(byType, presets, name) {
    var c = combine(byType, presets, name);
    var shot = Shot.build(c.spec, c.presets, c.choice);
    shot.recipe.blocks = c.spec.blocks;
    return { spec: c.spec, choice: c.choice, presets: c.presets, shot: shot };
  }

  // Shareable character recipe. `included` carries full copies of the blocks, so the file works anywhere.
  function recipe(name, byType, parentId) {
    var r = { persona_character: 1, name: str(name, 60) || null, blocks: {}, remix_of: parentId || null, included: [] };
    ORDER.forEach(function (t) {
      var b = byType[t]; if (!b) return;
      r.blocks[t] = b.address;
      r.included.push(share(b));
    });
    return r;
  }
  // The public, portable copy of one block.
  function share(b) {
    var o = { persona_block: 1, address: b.address, type: b.type, name: b.name, version: b.version, title: b.title, author: b.author || null,
      preview: b.preview || null, data: b.data, remix_of: b.remix_of || null, tags: b.tags || [] };
    if (b.type === "face") o.likeness = b.likeness || null;
    return o;
  }
  // Reads pasted JSON: a block, a list of blocks, or a character recipe.
  function parseShared(text) {
    var o = typeof text === "string" ? JSON.parse(text) : text;
    if (Array.isArray(o)) return { kind: "blocks", blocks: o.map(validate) };
    if (o && o.persona_character) {
      var blocks = {}, inc = (o.included || []).map(function (x) { try { return validate(x); } catch (e) { return null; } }).filter(Boolean);
      Object.keys(o.blocks || {}).forEach(function (t) { var p = parse(o.blocks[t]); if (p && p.type === t) blocks[t] = p.address; });
      if (!Object.keys(blocks).length) throw new Error("That character recipe doesn't point to any blocks.");
      return { kind: "character", name: str(o.name, 60), blocks: blocks, included: inc, remix_of: o.remix_of || null };
    }
    return { kind: "block", block: validate(o) };
  }

  // Drift guard for blocks: everyone using the same top face makes every character look alike.
  var POPULAR_FACE = 5;
  function varietyNotes(byType, uses) {
    var out = [], f = byType.face;
    if (f && (uses[f.address] || 0) >= POPULAR_FACE)
      out.push((uses[f.address]) + " characters already use the face " + f.address + ". Remix it (change two or three details) so yours stands out.");
    var picked = ORDER.filter(function (t) { return byType[t]; });
    if (picked.length && picked.every(function (t) { return byType[t].author === "Persona"; }) && picked.length >= 6)
      out.push("Every block here is a Persona starter. Swap in at least one community block or one of your own to make it yours.");
    if (!f) out.push("Pick a face block. Without one, the AI tool invents a new face every time.");
    return out;
  }
  // Least-used block per type (ties broken randomly), never the one already picked.
  function surprise(library, uses, current, rnd) {
    rnd = rnd || Math.random; var out = {};
    ORDER.forEach(function (t) {
      var opts = library.filter(function (b) { return b.type === t && (!current[t] || current[t].address !== b.address); });
      // Only the newest version of each family.
      var newest = {}; opts.forEach(function (b) { var k = b.type + "@" + b.name; if (!newest[k] || newest[k].version < b.version) newest[k] = b; });
      opts = Object.keys(newest).map(function (k) { return newest[k]; });
      if (!opts.length) return;
      var min = Math.min.apply(null, opts.map(function (b) { return uses[b.address] || 0; }));
      var pool = opts.filter(function (b) { return (uses[b.address] || 0) <= min + 1; });
      out[t] = pool[Math.floor(rnd() * pool.length)];
    });
    return out;
  }
  // Family tree: walks remix_of links back to the first block.
  function lineage(b, byAddress) {
    var out = [], seen = {}, cur = b;
    while (cur && cur.remix_of && !seen[cur.remix_of] && out.length < 20) {
      seen[cur.remix_of] = 1; out.push(cur.remix_of); cur = byAddress[cur.remix_of];
    }
    return out;
  }
  // Splits a registry spec (from the Character spec tab) into blocks you can publish.
  function fromSpec(spec, base) {
    spec = spec || {}; var id = spec.identity || {}, st = spec.style || {}, out = [];
    base = slug(base || spec.id || "my-character");
    function add(t, data, title) {
      try { out.push(validate({ type: t, name: base, title: title, data: data, likeness: t === "face" ? null : undefined })); } catch (e) {}
    }
    add("face", { age_range: id.age_range, face: id.face, eyes: id.eyes, skin: id.skin, signature_detail: id.signature_detail, never_change: id.never_change }, "Face");
    if (id.hair) add("hair", { cut: id.hair }, "Hair");
    if (id.body) add("body", { build: id.body }, "Body");
    if (list(st.outfit_staples).length || list(st.keywords).length) add("wardrobe", { outfit: list(st.outfit_staples).join(", "), style: st.keywords, palette: st.palette }, "Wardrobe");
    return out;
  }

  return { TYPES: TYPES, ORDER: ORDER, NAME_RE: NAME_RE, LIKENESS_TEXT: LIKENESS_TEXT, POPULAR_FACE: POPULAR_FACE,
    type: type, slug: slug, address: address, parse: parse, validate: validate, phrase: phrase, combine: combine, build: build,
    recipe: recipe, share: share, parseShared: parseShared, varietyNotes: varietyNotes, surprise: surprise, lineage: lineage, fromSpec: fromSpec };
});
