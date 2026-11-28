// Sale reports from affiliate networks ("postback" / "conversion webhook").
// URL to give each network:
//   https://persona-ai-characters.vercel.app/api/postback?network=<network>&token=<postback_token>
// plus the network's own placeholders for: click (our click id / sub id), order, sale, commission,
// currency, status. Common names (subid, clickref, sid, u1, order_id, amount...) are understood too.
"use strict";
const { db } = require("./_lib/shop");
const { body } = require("./_lib/persona");

function first(o, keys) { for (const k of keys) if (o[k] != null && o[k] !== "") return String(o[k]); return null; }
function num(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : null; }

module.exports = async function (req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    const q = Object.assign({}, req.query || {});
    if (req.method === "POST") {
      const b = await body(req).catch(() => ({}));
      Object.assign(q, typeof b === "object" && b ? b : {});
    }
    const lower = Object.fromEntries(Object.entries(q).map(([k, v]) => [k.toLowerCase(), v]));
    const result = await db(false).rpc("persona_record_conversion", {
      p_network: first(lower, ["network"]),
      p_token: first(lower, ["token"]),
      p_click: first(lower, ["click", "click_id", "subid", "sub_id", "subid1", "clickref", "sid", "u1", "cuid", "xcust", "ascsubtag"]),
      p_order: first(lower, ["order", "order_id", "orderid", "order_ref", "transaction_id", "transactionid", "oid"]),
      p_sale: num(first(lower, ["sale", "sale_amount", "amount", "order_value", "saleamount"])),
      p_commission: num(first(lower, ["commission", "commission_amount", "payout", "earnings"])),
      p_currency: (first(lower, ["currency", "currency_code"]) || "USD").toUpperCase().slice(0, 3),
      p_status: first(lower, ["status", "state"]) || "pending",
      p_raw: lower,
    });
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (e) {
    const msg = String(e.message || "");
    res.statusCode = /wrong token|28000|\(401\)|\(403\)/i.test(msg) ? 401 : /required|22023|\(400\)/.test(msg) ? 400 : 500;
    res.end(JSON.stringify({ ok: false, error: res.statusCode === 500 ? "Couldn't record the sale" : msg.replace(/^Supabase .*?: /, "") }));
  }
};
