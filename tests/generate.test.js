// Checks /api/generate with fake Supabase and Cloudflare: limits are claimed before the model runs,
// failures are released, prompts that point at real people are refused, and the provider can be swapped.
"use strict";
const assert = require("assert");

process.env.SUPABASE_URL = "https://db.example";
process.env.SUPABASE_ANON_KEY = "sb_publishable_test";
process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
process.env.CLOUDFLARE_API_TOKEN = "cf-token";
delete process.env.IMAGE_PROVIDER;

const Gen = require("../api/_lib/imagegen");
const handler = require("../api/generate");
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");

let calls = [], cf = () => ({ status: 200, body: { success: true, result: { image: JPEG } } }), claim = () => ({ status: 200, body: { id: 7, user_used: 1, site_used: 4 } });
global.fetch = async (url, opts) => {
  const b = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url, body: b, auth: opts.headers.Authorization });
  let r;
  if (url.includes("/rpc/image_gen_claim")) r = claim();
  else if (url.includes("/rpc/image_gen_finish")) r = { status: 204, body: null };
  else if (url.includes("/rpc/image_gen_usage")) r = { status: 200, body: { user_used: 2, site_used: 9 } };
  else if (url.includes("api.cloudflare.com")) r = cf();
  else throw new Error("unexpected " + url);
  return { ok: r.status < 300, status: r.status, text: async () => (r.body === null ? "" : JSON.stringify(r.body)) };
};
function run(method, body, auth) {
  return new Promise((resolve) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
      end(s) { resolve({ status: this.statusCode, body: s ? JSON.parse(s) : null }); } };
    handler({ method, headers: auth === false ? {} : { authorization: "Bearer " + JWT }, body, query: {} }, res);
  });
}

(async () => {
  let n = 0;
  // prompt checks
  assert.throws(() => Gen.checkPrompt("Photo of a celebrity lookalike in Paris"), /invented people/); n++;
  assert.throws(() => Gen.checkPrompt("  "), /empty/); n++;
  assert.ok(Gen.withInventedFace("Photo of x").startsWith("Fictional person")); n++;

  // status
  let r = await run("GET", null);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.ready, true);
  assert.strictEqual(r.body.model.id, "cf-flux-schnell"); assert.strictEqual(r.body.model.free, true);
  assert.deepStrictEqual(r.body.usage, { user_used: 2, site_used: 9 }); assert.deepStrictEqual(r.body.limits, { per_creator: 20, site: 80 }); n++;

  // happy path: claim -> Cloudflare -> finish(ok)
  calls = [];
  r = await run("POST", { character: "nova-reyes", prompt: "Photo of a person, short silver bob, standing in a market.", seed: 42 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.image, JPEG); assert.strictEqual(r.body.seed, 42); assert.strictEqual(r.body.usage.site_used, 4);
  assert.deepStrictEqual(calls.map((c) => c.url.split("/").pop()), ["image_gen_claim", "flux-1-schnell", "image_gen_finish"]);
  assert.strictEqual(calls[0].auth, "Bearer " + JWT, "claims as the signed-in creator");
  assert.strictEqual(calls[0].body.p_site_limit, 80);
  assert.ok(calls[1].body.prompt.startsWith("Fictional person"), "invented-face line added");
  assert.strictEqual(calls[1].body.seed, 42); assert.strictEqual(calls[1].body.steps, 4);
  assert.strictEqual(calls[2].body.p_ok, true); n++;

  // daily limit reached in Supabase: Cloudflare is never called
  calls = []; claim = () => ({ status: 400, body: { code: "54000", message: "Today's free images for Persona are used up (80 of 80)." } });
  r = await run("POST", { character: "nova-reyes", prompt: "Photo of a person in a field of flowers." });
  assert.strictEqual(r.status, 429); assert.match(r.body.error.message, /used up/);
  assert.ok(!calls.some((c) => c.url.includes("cloudflare"))); n++;

  // Cloudflare out of neurons: claim released, friendly message
  claim = () => ({ status: 200, body: { id: 8, user_used: 1, site_used: 1 } });
  cf = () => ({ status: 429, body: { success: false, errors: [{ message: "you have used up your daily free allocation of 10,000 neurons" }] } });
  calls = [];
  r = await run("POST", { character: "nova-reyes", prompt: "Photo of a person by the sea at dusk." });
  assert.strictEqual(r.status, 429); assert.match(r.body.error.message, /midnight UTC/);
  assert.strictEqual(calls[calls.length - 1].body.p_ok, false); n++;

  // not signed in / SQL not run / key missing
  r = await run("POST", { character: "nova-reyes", prompt: "Photo of a person." }, false);
  assert.strictEqual(r.status, 401); n++;
  claim = () => ({ status: 404, body: { code: "PGRST202", message: "Could not find the function public.image_gen_claim" } });
  r = await run("POST", { character: "nova-reyes", prompt: "Photo of a person on a bridge." });
  assert.strictEqual(r.status, 503); assert.match(r.body.error.message, /image-generation\.sql/); n++;
  delete process.env.CLOUDFLARE_API_TOKEN;
  r = await run("GET", null);
  assert.strictEqual(r.body.ready, false); assert.match(r.body.message, /CLOUDFLARE_API_TOKEN/); n++;

  // swapping in a paid model is just environment variables
  process.env.IMAGE_PROVIDER = "openai-gpt-image"; process.env.OPENAI_API_KEY = "sk-test"; process.env.GEN_DAILY_SITE = "500";
  const a = Gen.active();
  assert.strictEqual(a.ok, true); assert.strictEqual(a.info.family, "gpt-image"); assert.strictEqual(a.limits.site, 500); n++;
  process.env.IMAGE_PROVIDER = "nope";
  assert.strictEqual(Gen.active().ok, false); n++;

  console.log("generate ok: " + n + " checks");
})().catch((e) => { console.error(e); process.exit(1); });
