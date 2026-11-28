// Daily (Vercel cron): find the clothes in newly published images and link the closest real products.
"use strict";
const { db, cronAllowed } = require("../_lib/shop");
const { matchPending } = require("../_lib/matcher");

module.exports = async function (req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!cronAllowed(req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: "Not allowed" })); }
  const start = Date.now();
  try {
    const images = await matchPending(db(true), 10, start + 230 * 1000);
    res.statusCode = 200; res.end(JSON.stringify({ images, seconds: Math.round((Date.now() - start) / 1000) }));
  } catch (e) {
    console.error(e); res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
  }
};
