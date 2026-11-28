// Image generation providers for Studio's Shot builder.
// One active provider at a time, picked by the IMAGE_PROVIDER environment variable (default: the free one).
// To switch to a paid model later: add its key in Vercel and set IMAGE_PROVIDER to its id. Nothing else changes.
//
// Each provider:
//   name       shown to creators and saved in the image's origin record
//   family     which prompt format to use (a model id in templates/presets.json, used by Shot.compile)
//   free       true for a free tier (Studio shows the daily allowance)
//   size       output size
//   limits     default daily limits { per_creator, site } (override with GEN_DAILY_PER_CREATOR / GEN_DAILY_SITE)
//   env        environment variables it needs
//   run({ prompt, seed }) -> { image: Buffer, mime }
"use strict";

class GenError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || "generate_failed"; }
}

async function readJson(r) {
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch (e) { return { raw: text.slice(0, 300) }; }
}

const PROVIDERS = {
  // FLUX.1 [schnell] by Black Forest Labs (Apache 2.0: outputs can be used commercially), hosted by Cloudflare.
  // Free: 10,000 neurons a day on any Cloudflare account, reset 00:00 UTC. A 1024x1024, 4-step image costs
  // roughly 58 to 173 neurons depending on how Cloudflare counts steps, so about 55 to 170 images a day.
  // On the Workers Free plan Cloudflare refuses requests past the allowance, so it never bills.
  "cf-flux-schnell": {
    name: "FLUX.1 schnell (Cloudflare Workers AI, free tier)",
    family: "flux",
    free: true,
    size: "1024x1024",
    limits: { per_creator: 20, site: 80 },
    env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    async run({ prompt, seed }) {
      const acct = process.env.CLOUDFLARE_ACCOUNT_ID.trim(), token = process.env.CLOUDFLARE_API_TOKEN.trim();
      const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(acct) + "/ai/run/@cf/black-forest-labs/flux-1-schnell", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 4, seed }),
      });
      const data = await readJson(r);
      if (!r.ok || data.success === false) {
        const msg = ((data.errors || [])[0] || {}).message || data.raw || "HTTP " + r.status;
        if (r.status === 429 || /neuron|allocation|quota|rate limit/i.test(msg))
          throw new GenError(429, "Cloudflare's free images for today are used up. They reset at midnight UTC.", "limit");
        if (r.status === 401 || r.status === 403 || /auth/i.test(msg))
          throw new GenError(503, "The Cloudflare key on this site doesn't work. Check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in Vercel.", "not_configured");
        if (/nsfw|safety|flagged/i.test(msg)) throw new GenError(400, "The image model refused this prompt. Try changing the wording.", "refused");
        throw new GenError(502, "The image model didn't answer properly (" + String(msg).slice(0, 160) + "). Try again.", "upstream");
      }
      const b64 = data.result && data.result.image;
      if (!b64) throw new GenError(502, "The image model sent back no image. Try again.", "upstream");
      return { image: Buffer.from(b64, "base64"), mime: "image/jpeg" };
    },
  },

  // Paid example: OpenAI GPT Image. Set OPENAI_API_KEY and IMAGE_PROVIDER=openai-gpt-image to use it.
  // Billed per image by OpenAI; the limits below are just a safety cap.
  "openai-gpt-image": {
    name: "GPT Image (OpenAI)",
    family: "gpt-image",
    free: false,
    size: "1024x1536",
    limits: { per_creator: 30, site: 300 },
    env: ["OPENAI_API_KEY"],
    async run({ prompt }) {
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY.trim(), "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1", prompt: prompt.slice(0, 4000), size: "1024x1536", quality: "high", n: 1 }),
      });
      const data = await readJson(r);
      if (!r.ok) {
        const msg = (data.error && data.error.message) || data.raw || "HTTP " + r.status;
        if (r.status === 429) throw new GenError(429, "OpenAI is rate limiting or out of credit: " + msg, "limit");
        if (r.status === 400 && /safety|policy/i.test(msg)) throw new GenError(400, "The image model refused this prompt. Try changing the wording.", "refused");
        throw new GenError(502, "OpenAI didn't make the image (" + String(msg).slice(0, 160) + ").", "upstream");
      }
      const b64 = data.data && data.data[0] && data.data[0].b64_json;
      if (!b64) throw new GenError(502, "OpenAI sent back no image. Try again.", "upstream");
      return { image: Buffer.from(b64, "base64"), mime: "image/png" };
    },
  },
};

function activeId() { return (process.env.IMAGE_PROVIDER || "cf-flux-schnell").trim(); }

// The provider that is switched on, with its limits and whether its keys are set.
function active() {
  const id = activeId(), p = PROVIDERS[id];
  if (!p) return { id, ok: false, missing: [], message: "IMAGE_PROVIDER is set to “" + id + "”, which Persona doesn't know. Use one of: " + Object.keys(PROVIDERS).join(", ") + "." };
  const missing = p.env.filter((k) => !(process.env[k] || "").trim());
  const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    id, ok: !missing.length, missing, provider: p,
    info: { id, name: p.name, family: p.family, free: p.free, size: p.size },
    limits: { per_creator: num(process.env.GEN_DAILY_PER_CREATOR, p.limits.per_creator), site: num(process.env.GEN_DAILY_SITE, p.limits.site) },
  };
}

// Persona only makes invented people. This is a light check on top of the creator's own rights confirmation
// and the character spec (whose identity is written as an invented person).
const REAL_PERSON = /\b(celebrit(y|ies)|look[\s-]?alike|famous (person|actor|actress|singer|model)|real person|deepfake|face swap|in the likeness of)\b/i;
function checkPrompt(prompt) {
  const p = String(prompt || "").trim();
  if (p.length < 10) throw new GenError(400, "The prompt is empty. Build a shot first.", "bad_request");
  if (REAL_PERSON.test(p)) throw new GenError(400, "Persona only makes invented people. Remove words that point to a real or famous person.", "real_person");
  return p;
}
// Said once at the front of every prompt, so models don't drift toward a known face.
function withInventedFace(prompt) {
  return "Fictional person with an invented face, not resembling any real individual. " + prompt;
}

module.exports = { PROVIDERS, active, checkPrompt, withInventedFace, GenError };
