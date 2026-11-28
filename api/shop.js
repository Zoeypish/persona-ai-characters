// Shop links and sale reports in one function (keeps the site within Vercel's function limit).
//   /api/go?...        -> link router (rewritten here with action=go)
//   /api/postback?...  -> sale reports from affiliate networks (action=postback)
"use strict";
const go = require("./_handlers/go");
const postback = require("./_handlers/postback");
module.exports = function (req, res) {
  const action = (req.query && req.query.action) || "";
  if (action === "postback") return postback(req, res);
  return go(req, res);
};
