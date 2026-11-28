// Shared server code for the creator API (/api/v1/*) and the MCP server (/api/mcp).
// Talks to Supabase with the public key only. Every action goes through SQL functions in
// supabase/creator-api.sql, which check the creator's API key and the Studio rules themselves.
"use strict";
const dns = require("dns").promises;
const net = require("net");
const Shot = require("../../lib/shot.js");

const BUCKET = "character-images";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || "error"; }
}

function config() {
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url || !key) throw new ApiError(503, "Persona's database isn't connected on this deployment.", "not_configured");
  return { url, key };
}
function sbHeaders(extra) {
  const { key } = config();
  const h = Object.assign({ apikey: key }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = "Bearer " + key; // legacy anon JWT; new publishable keys go in apikey only
  return h;
}

const PG_STATUS = { "28000": 401, "42501": 403, "22023": 400, "54000": 429, "23505": 409, "23514": 400 };
async function rpc(name, args) {
  const { url } = config();
  let r;
  try {
    r = await fetch(url + "/rest/v1/rpc/" + name, {
      method: "POST", headers: sbHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(args || {}),
    });
  } catch (e) { throw new ApiError(502, "Couldn't reach Persona's database. Try again in a moment.", "upstream"); }
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) {
    const code = data && data.code, msg = (data && data.message) || "Database error";
    if (code === "PGRST202" || code === "42883" || /Could not find the function/i.test(msg))
      throw new ApiError(503, "AI connections aren't switched on yet. The site owner needs to run supabase/creator-api.sql in Supabase.", "not_enabled");
    throw new ApiError(PG_STATUS[code] || 400, msg, code === "28000" ? "unauthorized" : code === "54000" ? "limit" : "rejected");
  }
  return data;
}

// The creator's key: "Authorization: Bearer psn_...", "X-API-Key: psn_...", or ?key=psn_...
function apiKey(req) {
  const h = req.headers || {};
  let k = (h.authorization || "").replace(/^Bearer\s+/i, "").trim() || (h["x-api-key"] || "").trim();
  if (!k && req.query && req.query.key) k = String(req.query.key).trim();
  if (!k) throw new ApiError(401, "Missing API key. Create one in Persona Studio → Connect AI, then send it as a Bearer token.", "unauthorized");
  if (!/^psn_[0-9a-f]{48}$/.test(k)) throw new ApiError(401, "That doesn't look like a Persona API key (they start with psn_).", "unauthorized");
  return k;
}

// ---------- images ----------
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}
async function fetchImage(rawUrl, hops) {
  let u;
  try { u = new URL(rawUrl); } catch (e) { throw new ApiError(400, "image_url isn't a valid web address.", "bad_image"); }
  if (u.protocol !== "https:") throw new ApiError(400, "image_url must start with https://", "bad_image");
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new ApiError(400, "Couldn't download that image address.", "bad_image");
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try { r = await fetch(u, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": "PersonaBot/1.0 (+image import)", Accept: "image/*" } }); }
  catch (e) { clearTimeout(timer); throw new ApiError(400, "Couldn't download the image (timed out or refused).", "bad_image"); }
  if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
    clearTimeout(timer);
    if ((hops || 0) >= 3) throw new ApiError(400, "Too many redirects downloading the image.", "bad_image");
    return fetchImage(new URL(r.headers.get("location"), u).href, (hops || 0) + 1);
  }
  if (!r.ok) { clearTimeout(timer); throw new ApiError(400, "Couldn't download the image (HTTP " + r.status + ").", "bad_image"); }
  const len = Number(r.headers.get("content-length") || 0);
  if (len > MAX_IMAGE_BYTES) { clearTimeout(timer); throw new ApiError(413, "Image is larger than 10 MB.", "too_large"); }
  const chunks = []; let size = 0;
  try {
    for await (const c of r.body) {
      size += c.length; if (size > MAX_IMAGE_BYTES) { ctrl.abort(); throw new ApiError(413, "Image is larger than 10 MB.", "too_large"); }
      chunks.push(Buffer.from(c));
    }
  } finally { clearTimeout(timer); }
  return Buffer.concat(chunks);
}
function decodeBase64(s) {
  const m = /^data:image\/[a-z+]+;base64,(.*)$/is.exec(s);
  const buf = Buffer.from((m ? m[1] : s).replace(/\s+/g, ""), "base64");
  if (buf.length > MAX_IMAGE_BYTES) throw new ApiError(413, "Image is larger than 10 MB.", "too_large");
  return buf;
}
// Accepts { image_url } or { image_base64 } or ChatGPT's { openaiFileIdRefs: [...] } (first file).
async function readImageInput(input) {
  input = input || {};
  let buf;
  if (input.image_base64) buf = decodeBase64(String(input.image_base64));
  else if (input.image_url) buf = await fetchImage(String(input.image_url));
  else if (Array.isArray(input.openaiFileIdRefs) && input.openaiFileIdRefs.length) {
    const f = input.openaiFileIdRefs[0];
    const link = typeof f === "string" ? f : f && f.download_link;
    if (!link) throw new ApiError(400, "The attached file has no download link.", "bad_image");
    buf = await fetchImage(link);
  } else throw new ApiError(400, "Send the image as image_url (https), image_base64, or an attached file.", "bad_image");
  const kind = sniff(buf);
  if (!kind) throw new ApiError(415, "Only JPEG, PNG or WebP images are accepted.", "bad_image");
  return { buf, mime: kind.mime, ext: kind.ext };
}
async function uploadWithTicket(ticket, name, img) {
  const { url } = config();
  const path = "api/" + ticket + "/" + name + "." + img.ext;
  let r;
  try {
    r = await fetch(url + "/storage/v1/object/" + BUCKET + "/" + path, {
      method: "POST", headers: sbHeaders({ "Content-Type": img.mime, "x-upsert": "false", "Cache-Control": "max-age=31536000" }), body: img.buf,
    });
  } catch (e) { throw new ApiError(502, "Couldn't reach image storage. Try again.", "upstream"); }
  if (!r.ok) throw new ApiError(502, "Image storage refused the upload (" + r.status + "): " + (await r.text()).slice(0, 200), "upstream");
  return url + "/storage/v1/object/public/" + BUCKET + "/" + path;
}

// ---------- actions (used by both the REST API and the MCP server) ----------
const Persona = {
  me: (key) => rpc("api_me", { p_key: key }),
  async addImage(key, slug, input, opts) {
    opts = opts || {};
    const purpose = opts.avatar ? "avatar" : "image";
    const s = String(slug || "").trim();
    if (!s) throw new ApiError(400, "Say which character (its slug, e.g. nova-reyes).", "bad_request");
    const img = await readImageInput(input); // download/validate first, so a bad image doesn't use up a ticket
    const ticket = await rpc("api_upload_ticket", { p_key: key, p_slug: s, p_purpose: purpose });
    const publicUrl = await uploadWithTicket(ticket, purpose === "avatar" ? "avatar" : s + "-" + Date.now().toString(36), img);
    return rpc("api_finish_upload", { p_key: key, p_ticket: ticket, p_url: publicUrl, p_live: !!opts.live });
  },
  async createCharacter(key, body, origin) {
    body = body || {};
    const ch = await rpc("api_create_character", {
      p_key: key, p_name: body.name, p_handle: body.handle || null,
      p_bio: Array.isArray(body.bio) ? body.bio.join("\n\n") : body.bio || null,
    });
    const out = { character: ch, profile_url: origin ? origin + "/profile.html?c=" + ch.slug : undefined, images: [], warnings: [] };
    const avatar = body.avatar_url ? { image_url: body.avatar_url } : body.avatar_base64 ? { image_base64: body.avatar_base64 } : null;
    if (avatar) {
      try { const a = await Persona.addImage(key, ch.slug, avatar, { avatar: true }); ch.avatar_url = a.avatar_url; }
      catch (e) { out.warnings.push("Profile photo not saved: " + e.message); }
    }
    const imgs = (Array.isArray(body.image_urls) ? body.image_urls : []).slice(0, 6);
    for (const u of imgs) {
      try { out.images.push(await Persona.addImage(key, ch.slug, { image_url: u }, { live: !!body.live })); }
      catch (e) { out.warnings.push("Image " + u + " not saved: " + e.message); }
    }
    if (!out.warnings.length) delete out.warnings;
    return out;
  },
  listImages: (key, slug) => rpc("api_list_images", { p_key: key, p_slug: String(slug || "") }),
  setLive: (key, id, live) => rpc("api_set_live", { p_key: key, p_image_id: String(id || ""), p_live: !!live }),
  templates() {
    return {
      character_template: require("../../templates/character-template.json"),
      example: require("../../templates/example-nova-reyes.json"),
      image_prompt_pack: require("../../templates/image-prompt-pack.json"),
      starters: require("../../templates/starter-characters.json"),
      registry_template: require("../../templates/registry-template.json"),
      registry_example: require("../../templates/example-nova-reyes-spec.json"),
      presets: require("../../templates/presets.json"),
    };
  },

  // ---------- character registry, shot builder and drift guard (supabase/character-registry.sql) ----------
  registryGet: (key, slug, version) => rpc("api_registry_get", { p_key: key, p_slug: String(slug || ""), p_version: version ? Number(version) : null }).catch(registryOff),
  registrySave(key, slug, spec, note) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new ApiError(400, "Send the spec as a JSON object.", "bad_request");
    return rpc("api_registry_save", { p_key: key, p_slug: String(slug || ""), p_spec: spec, p_note: note || null }).catch(registryOff);
  },
  recentImages: (key, slug, limit) => rpc("api_recent_images", { p_key: key, p_slug: String(slug || ""), p_limit: limit || 40 }).catch(registryOff),
  tagImage: (key, id, recipe, specVersion, check) => rpc("api_tag_image", {
    p_key: key, p_image_id: String(id || ""), p_recipe: recipe || null, p_spec_version: specVersion ? Number(specVersion) : null, p_ai_check: check || null,
  }).catch(registryOff),
  // Drift guard report: variety (repeated set-ups, near-duplicates) and same-face checks.
  async driftReport(key, slug) {
    const recent = await Persona.recentImages(key, slug, 40);
    const presets = require("../../templates/presets.json");
    return {
      character: slug,
      variety: Shot.variety(presets, recent.map((i) => i.recipe)),
      near_duplicates: Shot.duplicates(recent.filter((i) => i.phash)),
      same_face: Shot.faceReport(recent),
      images: recent.length,
    };
  },
  // Wardrobe: real items from the product catalog (persona_products) to dress the character in.
  async wardrobe(q, ids) {
    const { url } = config();
    const sel = "select=id,store,title,price,sale_price,currency,link,image&available=eq.true&limit=12";
    let filter = "";
    const clean = (ids || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean).slice(0, 8);
    if (clean.length) filter = "&id=in.(" + clean.join(",") + ")";
    else if (q) {
      const words = String(q).replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 1).slice(0, 4);
      if (!words.length) return [];
      filter = "&and=" + encodeURIComponent("(" + words.map((w) => "title.ilike.*" + w + "*").join(",") + ")");
    }
    else return [];
    let r;
    try { r = await fetch(url + "/rest/v1/persona_products?" + sel + filter, { headers: sbHeaders() }); }
    catch (e) { throw new ApiError(502, "Couldn't reach the product catalog.", "upstream"); }
    if (!r.ok) throw new ApiError(502, "The product catalog didn't answer (" + r.status + ").", "upstream");
    return r.json();
  },
  // Builds an on-model prompt from the latest spec + presets, and checks it against recent images first.
  // Extra options: model (compile for that image tool), budget ("low" | "balanced" | "best"), products (catalog ids to wear).
  async buildShot(key, slug, choice) {
    choice = choice || {};
    const presets = require("../../templates/presets.json");
    const [reg, recent] = await Promise.all([Persona.registryGet(key, slug), Persona.recentImages(key, slug, 40)]);
    if (!reg.version) throw new ApiError(409, "This character has no spec yet. Save one first (saveCharacterSpec) or in Studio → Character spec.", "no_spec");
    const recipes = recent.map((i) => i.recipe);
    const pick = {};
    for (const g of Shot.GROUPS) {
      if (choice[g] && !Shot.find(presets, g, choice[g])) throw new ApiError(400, "Unknown " + g + " preset \"" + choice[g] + "\". See /templates/presets.json.", "bad_request");
      pick[g] = choice[g] || null;
    }
    if (choice.surprise || !Shot.GROUPS.some((g) => pick[g])) {
      const s = Shot.surprise(presets, recipes);
      for (const g of Shot.GROUPS) if (!pick[g]) pick[g] = s[g];
    }
    pick.outfit = choice.outfit; pick.extra = choice.extra;
    let products = [];
    if (Array.isArray(choice.products) && choice.products.length) {
      products = await Persona.wardrobe(null, choice.products);
      if (products.length) pick.outfit = [pick.outfit].concat(products.map((p) => p.title)).filter(Boolean).join(", ");
    }
    const shot = Shot.build(reg.spec, presets, pick, reg.version);
    shot.spec_version = reg.version;
    shot.variety = Shot.variety(presets, recipes, pick);
    shot.router = Shot.route(shot, presets, { budget: choice.budget, has_lora: !!choice.has_lora });
    const model = choice.model || shot.router.pick.id;
    shot.compiled = Shot.compile(shot, presets, model, slug);
    shot.recipe.model = model;
    if (products.length) shot.wardrobe = products;
    shot.recipe_json = Shot.toRecipe(slug, reg.version, pick, model, products.map((p) => p.id));
    shot.next_step = "Generate the image with compiled.prompt (attach compiled.attach reference images if you can), compare it with the references, then call addImage with recipe, spec_version and self_check.";
    return shot;
  },
};
function registryOff(e) {
  if (e instanceof ApiError && e.code === "not_enabled")
    throw new ApiError(503, "The character registry isn't switched on yet. The site owner needs to run supabase/character-registry.sql in Supabase.", "not_enabled");
  throw e;
}

// ---------- HTTP helpers ----------
function origin(req) {
  const h = req.headers || {};
  const host = h["x-forwarded-host"] || h.host || "persona-ai-characters.vercel.app";
  return (h["x-forwarded-proto"] || "https").split(",")[0] + "://" + String(host).split(",")[0];
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, Mcp-Session-Id, Mcp-Protocol-Version");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
async function body(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body !== "string" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : null;
  if (raw === null) { const chunks = []; for await (const c of req) chunks.push(c); raw = Buffer.concat(chunks).toString("utf8"); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw new ApiError(400, "Body must be JSON.", "bad_request"); }
}
// Wraps a handler: CORS, OPTIONS, JSON errors.
function handler(fn) {
  return async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    try { await fn(req, res); }
    catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: { code: e.code || "error", message: status === 500 ? "Something went wrong on Persona's side." : e.message } });
    }
  };
}

module.exports = { ApiError, Persona, apiKey, origin, send, body, handler, cors, rpc, readImageInput, _test: { privateIp, sniff } };
