// Studio image generation (Shot builder → Generate). Signed-in creators only, for their own characters.
//   GET  /api/generate           -> which model is on, and today's usage { user_used, site_used, limits }
//   POST /api/generate { character, prompt, seed? } -> one image { image (base64 JPEG), mime, seed, model, usage }
// Send the creator's Supabase session token as "Authorization: Bearer <access_token>".
// Batches are made one image per request by Studio, so each request stays short and the daily limits apply per image.
// Limits and the log live in Supabase (supabase/image-generation.sql). The provider is chosen in api/_lib/imagegen.js.
"use strict";
const { send, body, handler, ApiError } = require("./_lib/persona");
const Gen = require("./_lib/imagegen");

function sb() {
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url || !key) throw new ApiError(503, "Persona's database isn't connected on this deployment.", "not_configured");
  return { url, key };
}
function userToken(req) {
  const t = ((req.headers || {}).authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(t)) throw new ApiError(401, "Please sign in to Studio again.", "unauthorized");
  return t;
}
// Calls a Supabase function as the signed-in creator (so auth.uid() and the ownership checks apply).
async function rpc(token, name, args) {
  const { url, key } = sb();
  let r;
  try {
    r = await fetch(url + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
    });
  } catch (e) { throw new ApiError(502, "Couldn't reach Persona's database. Try again in a moment.", "upstream"); }
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) {
    const code = data && data.code, msg = (data && data.message) || "Database error";
    if (code === "PGRST202" || code === "42883" || code === "42P01" || /Could not find the function/i.test(msg))
      throw new ApiError(503, "Image generation isn't switched on yet. The site owner needs to run supabase/image-generation.sql in Supabase.", "not_enabled");
    if (r.status === 401 || code === "28000" || code === "PGRST301" || /JWT/i.test(msg)) throw new ApiError(401, "Please sign in to Studio again.", "unauthorized");
    const status = { "42501": 403, "54000": 429 }[code] || 400;
    throw new ApiError(status, msg, code === "54000" ? "limit" : "rejected");
  }
  return data;
}

function notReady(a) {
  if (a.message) return a.message;
  return "Image generation needs a key. The site owner adds " + a.missing.join(" and ") + " in Vercel → Settings → Environment Variables, then redeploys.";
}

// Smaller, uniform files: every result becomes a high-quality JPEG (falls back to the original bytes).
async function toJpeg(buf, mime) {
  if (mime === "image/jpeg") return buf;
  try { const sharp = require("sharp"); return await sharp(buf).jpeg({ quality: 90 }).toBuffer(); }
  catch (e) { return null; }
}

module.exports = handler(async (req, res) => {
  const a = Gen.active();
  if (req.method === "GET") {
    const out = { ready: a.ok, model: a.info || null, limits: a.limits || null, message: a.ok ? null : notReady(a) };
    const t = ((req.headers || {}).authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (t && a.ok) {
      try { out.usage = await rpc(t, "image_gen_usage", { p_provider: a.id }); }
      catch (e) { out.usage = null; if (e.code === "not_enabled") { out.ready = false; out.message = e.message; } }
    }
    return send(res, 200, out);
  }
  if (req.method !== "POST") throw new ApiError(405, "Use GET or POST.", "method");

  const token = userToken(req);
  if (!a.ok) throw new ApiError(503, notReady(a), "not_configured");
  const b = await body(req);
  const slug = String(b.character || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) throw new ApiError(400, "Say which character (its slug).", "bad_request");
  let prompt;
  try { prompt = Gen.checkPrompt(b.prompt); } catch (e) { throw new ApiError(e.status, e.message, e.code); }
  const seed = Number.isInteger(b.seed) && b.seed >= 0 && b.seed < 2147483647 ? b.seed : Math.floor(Math.random() * 2147483646);

  // Reserve the image first: checks the creator owns the character and the daily limits.
  const claim = await rpc(token, "image_gen_claim", {
    p_provider: a.id, p_model: a.info.name, p_slug: slug, p_prompt: prompt, p_seed: seed,
    p_user_limit: a.limits.per_creator, p_site_limit: a.limits.site,
  });
  let result;
  try {
    result = await a.provider.run({ prompt: Gen.withInventedFace(prompt), seed });
  } catch (e) {
    await rpc(token, "image_gen_finish", { p_id: claim.id, p_ok: false }).catch(() => {});
    if (e instanceof Gen.GenError) throw new ApiError(e.status, e.message, e.code);
    console.error(e);
    throw new ApiError(502, "The image model couldn't be reached. Try again in a moment.", "upstream");
  }
  await rpc(token, "image_gen_finish", { p_id: claim.id, p_ok: true }).catch(() => {});
  const jpg = await toJpeg(result.image, result.mime);
  send(res, 200, {
    image: (jpg || result.image).toString("base64"),
    mime: jpg ? "image/jpeg" : result.mime,
    seed,
    model: a.info,
    usage: { user_used: claim.user_used, site_used: claim.site_used },
    limits: a.limits,
  });
});
