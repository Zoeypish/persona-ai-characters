// Shop the look, automatically: for a new image, find each garment (Claude vision), cut it out,
// compare the cut-out to product photos by look (image vectors), then let Claude pick the closest
// real items from the shortlist. Works without vectors too (text search only) until VOYAGE_API_KEY is set.
"use strict";
const Anthropic = require("@anthropic-ai/sdk");
const { env } = require("./shop");

const MODEL = () => env("PERSONA_MATCH_MODEL") || "claude-opus-5-5";
const VOYAGE_MODEL = () => env("VOYAGE_MODEL") || "voyage-multimodal-3.5";
const MAX_GARMENTS = 6, PER_GARMENT = 3;

let client = null;
function claude() {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY isn't set in Vercel.");
  if (!client) client = new Anthropic();
  return client;
}

// One structured call: returns parsed JSON that matches `schema`. Falls back to another model on a refusal.
async function askJson(content, schema, maxTokens) {
  const response = await claude().beta.messages.create({
    model: MODEL(),
    max_tokens: maxTokens || 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to describe this image.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

const GARMENT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["garments"],
  properties: {
    garments: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["category", "description", "colour", "search_terms", "box"],
        properties: {
          category: { type: "string", enum: ["top", "shirt", "knit", "dress", "skirt", "trousers", "jeans", "shorts", "jacket", "coat", "suit", "swimwear", "activewear", "shoes", "bag", "hat", "jewellery", "sunglasses", "other"] },
          description: { type: "string", description: "Short shopper-style description, e.g. 'black ribbed knit tank top'" },
          colour: { type: "string" },
          search_terms: { type: "string", description: "6-10 words a shop would use in the product title or tags" },
          box: {
            type: "object", additionalProperties: false, required: ["x", "y", "w", "h"],
            description: "Where the item is, as fractions of the image width/height (0 to 1), top-left origin",
            properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
          },
        },
      },
    },
  },
};

// Step 1: garment finder.
async function findGarments(imageUrl) {
  const out = await askJson([
    { type: "image", source: { type: "url", url: imageUrl } },
    { type: "text", text: "This is a fashion image of a virtual character. List each clearly visible clothing item or accessory the character is wearing (at most " + MAX_GARMENTS + ", most visible first), so a shopper could find similar items. Ignore the background, props and the person's body, hair and makeup. For each item give its box as fractions of the image size." },
  ], GARMENT_SCHEMA, 3000);
  return (out.garments || []).slice(0, MAX_GARMENTS);
}

// Step 2: cut each garment out of the image (a little padding helps the vector model).
async function cropGarments(imageUrl, garments) {
  let sharp;
  try { sharp = require("sharp"); } catch (e) { return garments.map(() => null); }
  const r = await fetch(imageUrl);
  if (!r.ok) return garments.map(() => null);
  const buf = Buffer.from(await r.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const W = meta.width, H = meta.height;
  return Promise.all(garments.map(async (g) => {
    const b = g.box || {}, pad = 0.04;
    const x = Math.max(0, (b.x || 0) - pad), y = Math.max(0, (b.y || 0) - pad);
    const w = Math.min(1 - x, (b.w || 0) + pad * 2), h = Math.min(1 - y, (b.h || 0) + pad * 2);
    if (!(w > 0.03 && h > 0.03 && W && H)) return null;
    try {
      const out = await sharp(buf).extract({ left: Math.round(x * W), top: Math.round(y * H), width: Math.max(8, Math.round(w * W)), height: Math.max(8, Math.round(h * H)) })
        .resize({ width: 512, height: 512, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
      return "data:image/jpeg;base64," + out.toString("base64");
    } catch (e) { return null; }
  }));
}

// Image vectors (Voyage multimodal). inputs: [{image_url}|{image_base64}, optional text]
async function embed(inputs, inputType) {
  const key = env("VOYAGE_API_KEY");
  if (!key) return null;
  const r = await fetch((env("VOYAGE_BASE_URL") || "https://api.voyageai.com/v1") + "/multimodalembeddings", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: VOYAGE_MODEL(), input_type: inputType || "document", inputs: inputs.map((i) => ({ content: i })) }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Voyage embeddings failed (" + r.status + "): " + String(data.detail || "").slice(0, 200));
  return (data.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// Nightly: give product photos without a vector one. Returns how many were done.
async function embedProducts(sb, limit, deadline) {
  if (!env("VOYAGE_API_KEY")) return { skipped: "VOYAGE_API_KEY isn't set" };
  const todo = await sb.rpc("persona_products_to_embed", { p_limit: limit || 300 });
  let done = 0, failed = 0;
  for (let i = 0; i < todo.length && Date.now() < deadline; i += 25) {
    const batch = todo.slice(i, i + 25);
    try {
      const vecs = await embed(batch.map((p) => [{ type: "image_url", image_url: p.image }]), "document");
      done += await sb.rpc("persona_set_embeddings", { p_rows: batch.map((p, k) => ({ id: p.id, image: p.image, embedding: vecs[k] })) });
    } catch (e) {
      // One bad photo fails the whole batch; retry those one at a time so the rest still get vectors.
      for (const p of batch) {
        try {
          const [v] = await embed([[{ type: "image_url", image_url: p.image }]], "document");
          done += await sb.rpc("persona_set_embeddings", { p_rows: [{ id: p.id, image: p.image, embedding: v }] });
        } catch (e2) { failed++; }
      }
    }
  }
  return { embedded: done, failed, waiting: Math.max(0, todo.length - done - failed) };
}

const PICK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["garment", "product_ids", "scores"],
        properties: {
          garment: { type: "integer", description: "Garment number from the list" },
          product_ids: { type: "array", items: { type: "integer" } },
          scores: { type: "array", items: { type: "number" }, description: "0 to 1, how close each pick is" },
        },
      },
    },
  },
};

// Steps 3-4: shortlist by look (vectors) and by words (text search), then Claude picks the closest.
async function matchImage(sb, job) {
  const garments = await findGarments(job.image_url);
  if (!garments.length) return { status: "no_garments", garments, items: [] };

  let vectors = null;
  if (env("VOYAGE_API_KEY")) {
    const crops = await cropGarments(job.image_url, garments).catch(() => garments.map(() => null));
    const inputs = garments.map((g, i) => crops[i]
      ? [{ type: "image_base64", image_base64: crops[i] }, { type: "text", text: g.description }]
      : [{ type: "text", text: g.description + " " + g.search_terms }]);
    vectors = await embed(inputs, "query").catch(() => null);
  }

  const shortlists = await Promise.all(garments.map(async (g, i) => {
    const seen = new Map();
    if (vectors && vectors[i]) {
      (await sb.rpc("persona_visual_candidates", { p_embedding: JSON.stringify(vectors[i]), p_limit: 15 })).forEach((p) => seen.set(p.id, p));
    }
    (await sb.rpc("persona_match_candidates", { p_terms: g.colour + " " + g.description + " " + g.search_terms, p_limit: 12 })).forEach((p) => { if (!seen.has(p.id)) seen.set(p.id, p); });
    return [...seen.values()].slice(0, 20);
  }));
  if (!shortlists.some((l) => l.length)) return { status: "done", garments, items: [] };

  const list = garments.map((g, i) => "Garment " + i + ": " + g.description + " (" + g.category + ", " + g.colour + ")\n" +
    (shortlists[i].length ? shortlists[i].map((p) => "  - id " + p.id + ": " + p.title + " | " + (p.product_type || "") + " | " + (p.colour || "") + " | " + p.store + " | $" + p.price_usd).join("\n") : "  (no candidates)")).join("\n\n");
  const out = await askJson([
    { type: "image", source: { type: "url", url: job.image_url } },
    { type: "text", text: "Here are the garments found in this image, each with candidate products from our catalogue.\n\n" + list +
      "\n\nFor each garment pick up to " + PER_GARMENT + " products a shopper would accept as the same item or a very close substitute: same type of garment first, then colour, then style. Pick none for a garment if nothing fits. Only use ids from that garment's list." },
  ], PICK_SCHEMA, 3000);

  const items = [], used = new Set();
  (out.picks || []).forEach((p) => {
    const g = garments[p.garment]; const allowed = new Set((shortlists[p.garment] || []).map((c) => c.id));
    if (!g) return;
    (p.product_ids || []).slice(0, PER_GARMENT).forEach((id, k) => {
      if (!allowed.has(id) || used.has(id)) return;
      used.add(id);
      items.push({ pin_id: job.pin_id, product_id: id, garment: g.description.slice(0, 120), score: Math.max(0, Math.min(1, Number((p.scores || [])[k]) || 0.5)), source: "auto" });
    });
  });
  return { status: "done", garments, items };
}

// Cron entry: match images that are live but have no products yet.
async function matchPending(sb, limit, deadline) {
  const jobs = await sb.rpc("persona_images_to_match", { p_limit: limit || 8 });
  const results = [];
  for (const job of jobs) {
    if (Date.now() > deadline) break;
    let res, prev = null;
    try {
      res = await matchImage(sb, job);
      if (res.items.length) await sb.insert("persona_look_items", res.items, "pin_id,product_id", true);
      await sb.insert("persona_look_jobs", [{ pin_id: job.pin_id, status: res.status, garments: res.garments, error: null, updated_at: new Date().toISOString() }], "pin_id");
      results.push({ image: job.pin_id, garments: res.garments.length, products: res.items.length });
    } catch (e) {
      try { prev = (await sb.select("persona_look_jobs", "pin_id=eq." + encodeURIComponent(job.pin_id) + "&select=tries"))[0]; } catch (e2) { /* first try */ }
      await sb.insert("persona_look_jobs", [{ pin_id: job.pin_id, status: "failed", error: String(e.message).slice(0, 500), tries: prev ? prev.tries + 1 : 1, updated_at: new Date().toISOString() }], "pin_id").catch(() => {});
      results.push({ image: job.pin_id, error: e.message });
    }
  }
  return results;
}

module.exports = { matchPending, matchImage, embedProducts, findGarments, _test: { GARMENT_SCHEMA, PICK_SCHEMA } };
