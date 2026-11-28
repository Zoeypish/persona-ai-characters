// Nightly jobs (Vercel cron), one function for both so the site stays within Vercel's function limit:
//   /api/cron/refresh-products  and  /api/cron/match-looks
"use strict";
const jobs = {
  "refresh-products": require("../_handlers/refresh-products"),
  "match-looks": require("../_handlers/match-looks"),
};
module.exports = function (req, res) {
  const job = (req.query && req.query.job) || String(req.url || "").split("?")[0].split("/").pop();
  const fn = jobs[job];
  if (!fn) { res.statusCode = 404; res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ error: "Unknown job" })); }
  return fn(req, res);
};
