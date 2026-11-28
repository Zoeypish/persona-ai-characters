// Server code for the shop engine: database access, affiliate links, product refresh and currency.
// Writes use the Supabase secret key (SUPABASE_SECRET_KEY, set in Vercel), which never reaches browsers.
"use strict";
const zlib = require("zlib");

const UA = "Mozilla/5.0 (compatible; PersonaCatalogBot/1.0; +https://persona-ai-characters.vercel.app/docs/shop-engine)";

function env(name) { return (process.env[name] || "").trim(); }
function dbConfig(secret) {
  const url = env("SUPABASE_URL").replace(/\/+$/, "");
  const key = secret
    ? env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")
    : env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error(secret ? "SUPABASE_SECRET_KEY isn't set in Vercel." : "Supabase isn't configured.");
  return { url, key };
}
function headers(key, extra) {
  const h = Object.assign({ apikey: key, "Content-Type": "application/json" }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = "Bearer " + key; // legacy JWT keys; new sb_ keys go in apikey only
  return h;
}
// Tiny PostgREST client. db(true) = secret key (server jobs), db(false) = public key.
function db(secret) {
  const { url, key } = dbConfig(secret);
  async function call(method, path, bodyObj, extra) {
    const r = await fetch(url + "/rest/v1/" + path, {
      method, headers: headers(key, extra), body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
    });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) throw new Error("Supabase " + method + " " + path.split("?")[0] + " failed (" + r.status + "): " + ((data && data.message) || text).slice(0, 300));
    return data;
  }
  return {
    rpc: (name, args) => call("POST", "rpc/" + name, args || {}),
    select: (table, query) => call("GET", table + "?" + query),
    insert: (table, rows, onConflict, ignore) => call("POST", table + (onConflict ? "?on_conflict=" + onConflict : ""), rows,
      { Prefer: (ignore ? "resolution=ignore-duplicates" : "resolution=merge-duplicates") + ",return=minimal" }),
    update: (table, query, patch) => call("PATCH", table + "?" + query, patch, { Prefer: "return=minimal" }),
  };
}

// ---------- affiliate links ----------
// Fill a network's deeplink template for one click. {url} is encoded, {url_raw} is not.
function buildAffiliateUrl(info, extraParams) {
  const link = withParams(info.link, extraParams);
  if (!info.deeplink || !info.publisher_id) return link;
  if (/\{merchant_id\}/.test(info.deeplink) && !info.merchant_id) return link;
  const vals = { publisher_id: info.publisher_id, merchant_id: info.merchant_id || "", click: info.click, url: encodeURIComponent(link), url_raw: link };
  const out = info.deeplink.replace(/\{(publisher_id|merchant_id|click|url_raw|url)\}/g, (m, k) => {
    return k === "url" || k === "url_raw" ? vals[k] : k === "merchant_id" && /^https?:/.test(vals[k]) ? vals[k] : encodeURIComponent(vals[k]);
  });
  return /^https:\/\//.test(out) ? out : link;
}
function withParams(link, params) {
  try {
    const u = new URL(link);
    Object.entries(params || {}).forEach(([k, v]) => { if (v && !u.searchParams.has(k)) u.searchParams.set(k, v); });
    return u.toString();
  } catch (e) { return link; }
}

// ---------- polite fetching ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, opts) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 20000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: (opts && opts.accept) || "application/json,text/plain,*/*" }, signal: ctrl.signal, redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return opts && opts.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
}

// robots.txt: is our bot (or everyone) allowed to fetch this path?
function robotsAllows(txt, path, agent) {
  agent = (agent || "PersonaCatalogBot").toLowerCase();
  const groups = []; let cur = null, lastWasAgent = false;
  String(txt || "").split(/\r?\n/).forEach((line) => {
    const l = line.replace(/#.*/, "").trim(); if (!l) return;
    const i = l.indexOf(":"); if (i < 0) return;
    const k = l.slice(0, i).trim().toLowerCase(), v = l.slice(i + 1).trim();
    if (k === "user-agent") {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v });
    }
  });
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  use.forEach((g) => g.rules.forEach((r) => {
    if (!r.path) return;
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }));
  return !best || best.allow;
}

// ---------- product rows ----------
function money(v) { const f = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return f > 0 ? Math.round(f * 100) / 100 : null; }
const COLOURS = ["black", "white", "ivory", "cream", "beige", "tan", "camel", "brown", "chocolate", "grey", "gray", "charcoal", "silver", "gold",
  "navy", "blue", "denim", "indigo", "green", "olive", "sage", "khaki", "red", "burgundy", "pink", "rose", "blush", "purple", "lilac", "lavender",
  "yellow", "orange", "coral", "multi", "print", "floral", "stripe", "leopard"];
function guessColour(text) {
  const t = " " + String(text || "").toLowerCase().replace(/[^a-z]+/g, " ") + " ";
  const hit = COLOURS.find((c) => t.includes(" " + c + " "));
  return hit === "gray" ? "grey" : hit || null;
}
function shopifyRow(source, p, currency, now) {
  const variants = p.variants || [];
  if (!variants.length || !(p.images || []).length) return null;
  const avail = variants.filter((v) => v.available);
  const pool = avail.length ? avail : variants;
  const v = pool.reduce((a, b) => ((money(b.price) || 1e9) < (money(a.price) || 1e9) ? b : a));
  const cur = money(v.price), cmp = money(v.compare_at_price);
  if (cur == null) return null;
  const onSale = cmp != null && cmp > cur;
  const sizes = [];
  variants.forEach((x) => { const t = String(x.option1 || x.title || "").trim(); if (t && t.toLowerCase() !== "default title" && !sizes.includes(t)) sizes.push(t); });
  let tags = p.tags || []; if (typeof tags === "string") tags = tags.split(",").map((s) => s.trim()).filter(Boolean);
  const desc = String(p.body_html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  return {
    store: source.name, store_domain: source.domain, source: "shopify", external_id: String(p.id),
    title: String(p.title || "").trim(), product_type: String(p.product_type || "").trim() || null, tags: tags.slice(0, 20),
    price: onSale ? cmp : cur, sale_price: onSale ? cur : null, currency: currency || "USD",
    link: "https://" + source.domain + "/products/" + p.handle, image: p.images[0].src,
    images: p.images.slice(0, 6).map((i) => i.src), description: desc, vendor: String(p.vendor || "").trim() || null,
    sizes: sizes.slice(0, 20), published_at: p.published_at || p.created_at || null,
    available: variants.some((x) => x.available), colour: guessColour(p.title + " " + tags.join(" ")),
    fetched_at: now, last_seen_at: now,
  };
}

// ---------- feeds (Awin, Google-format feeds used by Rakuten, CJ, Impact and brands) ----------
function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  const delim = (text.slice(0, 2000).split("\t").length > text.slice(0, 2000).split(",").length) ? "\t" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}
function parseXmlItems(text) {
  const items = [];
  const re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g; let m;
  while ((m = re.exec(text))) {
    const o = {}; const f = /<(?:g:)?([a-z_]+)\b[^>]*>([\s\S]*?)<\/(?:g:)?\1>/g; let x;
    while ((x = f.exec(m[2]))) {
      const v = x[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
      if (!(x[1] in o)) o[x[1]] = v;
    }
    items.push(o);
  }
  return items;
}
const FEED_PRESETS = {
  awin: { id: "aw_product_id", title: "product_name", link: "merchant_deep_link", image: ["merchant_image_url", "aw_image_url", "large_image"],
    price: ["rrp_price", "product_price_old", "search_price"], sale_price: "search_price", currency: "currency", available: ["in_stock", "stock_status"],
    type: ["merchant_category", "category_name"], brand: "brand_name", description: "description", colour: "colour" },
  google: { id: "id", title: "title", link: "link", image: "image_link", price: "price", sale_price: "sale_price", currency: null,
    available: "availability", type: ["product_type", "google_product_category"], brand: "brand", description: "description", colour: "color" },
};
function pick(o, keys) { for (const k of [].concat(keys || [])) if (k && o[k] != null && o[k] !== "") return o[k]; return null; }
function feedRow(source, o, now) {
  const map = source.feed_format === "custom" && source.feed_mapping ? Object.assign({}, FEED_PRESETS.google, source.feed_mapping) : FEED_PRESETS[source.feed_format || "google"] || FEED_PRESETS.google;
  const id = pick(o, map.id), title = pick(o, map.title), link = pick(o, map.link);
  if (!id || !title || !/^https?:\/\//.test(link || "")) return null;
  const rawPrice = pick(o, map.price), rawSale = pick(o, map.sale_price);
  let price = money(rawPrice), sale = money(rawSale);
  if (price == null) { price = sale; sale = null; }
  if (price == null) return null;
  if (sale != null && sale >= price) sale = null;
  const currency = (pick(o, map.currency) || (String(rawPrice).match(/\b[A-Z]{3}\b/) || [])[0] || "USD").toUpperCase();
  const availRaw = String(pick(o, map.available) || "in stock").toLowerCase();
  const type = pick(o, map.type);
  return {
    store: source.name, store_domain: source.domain, source: "feed:" + (source.network || source.feed_format || "feed"), external_id: String(id).slice(0, 120),
    title: String(title).slice(0, 300), product_type: type ? String(type).split(/[>|]/).pop().trim().slice(0, 120) : null, tags: [],
    price, sale_price: sale, currency, link, image: pick(o, map.image), images: [pick(o, map.image)].filter(Boolean),
    description: String(pick(o, map.description) || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null,
    vendor: pick(o, map.brand), sizes: [], published_at: null,
    available: !/out|^0$|^no$|false|discontinued/.test(availRaw),
    colour: guessColour(pick(o, map.colour) || title), fetched_at: now, last_seen_at: now,
  };
}

// ---------- refresh one source ----------
async function fetchShopify(source, opts) {
  const pause = opts.pause == null ? 1500 : opts.pause, maxPages = opts.maxPages || 4;
  try {
    const robots = await get("https://" + source.domain + "/robots.txt", { accept: "text/plain" });
    if (!robotsAllows(robots, "/products.json")) return { status: "robots.txt says no", rows: [] };
  } catch (e) { /* no robots.txt: allowed */ }
  await sleep(pause);
  let currency = null;
  try { currency = JSON.parse(await get("https://" + source.domain + "/meta.json")).currency || null; } catch (e) { /* fall back below */ }
  const products = [];
  for (let page = 1; page <= maxPages; page++) {
    await sleep(pause);
    let data;
    try { data = JSON.parse(await get("https://" + source.domain + "/products.json?limit=250&page=" + page)); }
    catch (e) { if (page === 1) return { status: "no product list (" + e.message + ")", rows: [] }; break; }
    const batch = data.products || []; products.push(...batch);
    if (batch.length < 250 || Date.now() > opts.deadline) break;
  }
  if (!currency) { try { currency = JSON.parse(await get("https://" + source.domain + "/cart.js")).currency || null; } catch (e) { /* USD */ } }
  const now = new Date().toISOString();
  const rows = products.map((p) => shopifyRow(source, p, currency, now)).filter(Boolean);
  return { status: "ok", rows, currency };
}
async function fetchFeed(source) {
  if (!source.feed_url) return { status: "feed_url is empty", rows: [] };
  let buf = await get(source.feed_url, { binary: true, timeout: 60000, accept: "*/*" });
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const text = buf.toString("utf8");
  const items = /^\s*</.test(text) ? parseXmlItems(text) : parseCsv(text);
  const now = new Date().toISOString();
  return { status: "ok", rows: items.map((o) => feedRow(source, o, now)).filter(Boolean).slice(0, 20000) };
}
async function refreshSource(sb, source, opts) {
  const started = new Date().toISOString();
  let result;
  try { result = source.kind === "feed" ? await fetchFeed(source) : await fetchShopify(source, opts); }
  catch (e) { result = { status: "failed: " + e.message, rows: [] }; }
  const seen = new Map(); result.rows.forEach((r) => seen.set(r.external_id, r)); // a feed can repeat ids
  const rows = [...seen.values()];
  for (let i = 0; i < rows.length; i += 500) await sb.insert("persona_products", rows.slice(i, i + 500), "store_domain,external_id");
  if (rows.length) {
    // Anything this store no longer lists is marked sold out (kept, so old links and history still work).
    await sb.update("persona_products", "store_domain=eq." + encodeURIComponent(source.domain) + "&last_seen_at=lt." + encodeURIComponent(started) + "&available=is.true", { available: false });
  }
  await sb.update("persona_sources", "id=eq." + source.id, { last_run_at: new Date().toISOString(), last_status: result.status, last_count: rows.length });
  return { store: source.name, status: result.status, products: rows.length };
}

// ---------- currency ----------
async function refreshRates(sb) {
  const data = JSON.parse(await get("https://api.frankfurter.app/latest?from=USD"));
  const now = new Date().toISOString();
  const rows = [{ currency: "USD", usd_per_unit: 1, updated_at: now }].concat(
    Object.entries(data.rates || {}).filter(([, v]) => v > 0).map(([c, v]) => ({ currency: c, usd_per_unit: Math.round((1 / v) * 1e6) / 1e6, updated_at: now })));
  await sb.insert("persona_fx_rates", rows, "currency");
  const updated = await sb.rpc("persona_apply_fx");
  return { currencies: rows.length, products_repriced: updated };
}

// Vercel cron requests carry "Authorization: Bearer <CRON_SECRET>".
function cronAllowed(req) {
  const secret = env("CRON_SECRET");
  return !!secret && (req.headers || {}).authorization === "Bearer " + secret;
}

module.exports = { db, env, buildAffiliateUrl, refreshSource, refreshRates, cronAllowed, sleep,
  _test: { robotsAllows, shopifyRow, feedRow, parseCsv, parseXmlItems, guessColour, money, withParams } };
