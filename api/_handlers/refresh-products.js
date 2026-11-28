// Daily (Vercel cron): exchange rates, then each brand's products, prices and stock, then image vectors
// for new product photos. Stores that don't finish today are first in line tomorrow.
"use strict";
const { db, refreshSource, refreshRates, cronAllowed, env } = require("../_lib/shop");
const { embedProducts } = require("../_lib/matcher");

module.exports = async function (req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!cronAllowed(req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: "Not allowed" })); }
  const start = Date.now(), deadline = start + 240 * 1000; // stop starting new work after 4 minutes
  const report = { started: new Date(start).toISOString(), stores: [] };
  try {
    const sb = db(true);
    try { report.rates = await refreshRates(sb); } catch (e) { report.rates = { error: e.message }; }
    const sources = await sb.select("persona_sources", "enabled=is.true&order=last_run_at.asc.nullsfirst&select=*");
    for (const s of sources) {
      if (Date.now() > deadline - 30000) { report.stores.push({ store: s.name, status: "next run" }); continue; }
      report.stores.push(await refreshSource(sb, s, { deadline: deadline - 20000, maxPages: Number(env("CRAWL_MAX_PAGES")) || 4 }));
    }
    // Prices may have changed currency or been added: make sure dollars are current.
    try { await sb.rpc("persona_apply_fx"); } catch (e) { /* reported by rates above */ }
    report.vectors = await embedProducts(sb, 400, deadline + 40000).catch((e) => ({ error: e.message }));
    report.seconds = Math.round((Date.now() - start) / 1000);
    res.statusCode = 200; res.end(JSON.stringify(report));
  } catch (e) {
    console.error(e); res.statusCode = 500; res.end(JSON.stringify(Object.assign(report, { error: e.message })));
  }
};
