// Shop link router: /api/go?p=<product id>&pin=<image id>&c=<character slug>
// Logs the click (so a later sale is credited to the right character and creator), picks the
// affiliate link that pays the most for this item, and sends the shopper to the store.
"use strict";
const { db, buildAffiliateUrl } = require("../_lib/shop");

function redirect(res, url) {
  res.statusCode = 302;
  res.setHeader("Location", url);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
  res.end();
}
module.exports = async function (req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  let id = /^\d{1,12}$/.test(String(q.p || "")) ? Number(q.p) : null;
  const clean = (v, n) => (typeof v === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(v) ? v.slice(0, n) : null);
  try {
    // Search results identify a product by store + store's own id: /api/go?d=<domain>&x=<id>
    if (!id && clean(q.d, 80) && clean(q.x, 80)) {
      const rows = await db(false).select("persona_products", "select=id&store_domain=eq." + encodeURIComponent(q.d) + "&external_id=eq." + encodeURIComponent(q.x) + "&limit=1");
      id = rows && rows[0] ? rows[0].id : null;
    }
    if (!id) return redirect(res, "/");
    const info = await db(false).rpc("persona_log_click", { p_product: id, p_pin: clean(q.pin, 80), p_character: clean(q.c, 60) });
    if (!info || !info.link) return redirect(res, "/");
    // Without an affiliate network the store still sees the visit came from Persona.
    const extra = info.network ? null : { utm_source: "persona", utm_medium: "shop_the_look", utm_campaign: clean(q.c, 60) || "persona" };
    return redirect(res, buildAffiliateUrl(info, extra));
  } catch (e) {
    console.error(e);
    return redirect(res, "/");
  }
};
