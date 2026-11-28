// Unit tests for the shop engine helpers. Run: npm test   (no network or database needed)
"use strict";
const assert = require("assert");
const { buildAffiliateUrl, _test: t } = require("../api/_lib/shop");
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

ok("robots.txt: Shopify default allows /products.json", () => {
  const txt = "User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /*?*variant=*\n";
  assert.strictEqual(t.robotsAllows(txt, "/products.json"), true);
});
ok("robots.txt: blocks when told to", () => {
  assert.strictEqual(t.robotsAllows("User-agent: *\nDisallow: /products.json", "/products.json"), false);
  assert.strictEqual(t.robotsAllows("User-agent: *\nDisallow: /", "/products.json"), false);
  assert.strictEqual(t.robotsAllows("User-agent: PersonaCatalogBot\nDisallow: /\n\nUser-agent: *\nAllow: /", "/products.json"), false);
  assert.strictEqual(t.robotsAllows("User-agent: *\nDisallow: /\nAllow: /products.json", "/products.json"), true);
});
ok("Shopify product: sale price, sizes, colour, availability", () => {
  const row = t.shopifyRow({ name: "Staud", domain: "staud.clothing" }, {
    id: 1, handle: "lynelle", title: "Lynelle Silk Tank | Black", product_type: "Tops", tags: "silk, tank",
    body_html: "<p>Silk <b>tank</b></p>", vendor: "Staud", images: [{ src: "https://x/a.jpg" }],
    variants: [{ price: "95.00", compare_at_price: "195.00", available: true, option1: "S" }, { price: "95.00", compare_at_price: "195.00", available: false, option1: "M" }],
  }, "USD", "2026-11-28T00:00:00Z");
  assert.strictEqual(row.price, 195); assert.strictEqual(row.sale_price, 95);
  assert.deepStrictEqual(row.sizes, ["S", "M"]); assert.strictEqual(row.colour, "black");
  assert.strictEqual(row.available, true); assert.strictEqual(row.link, "https://staud.clothing/products/lynelle");
  assert.strictEqual(row.description, "Silk tank");
});
ok("Awin CSV feed row", () => {
  const rows = t.parseCsv('aw_product_id,product_name,merchant_deep_link,merchant_image_url,search_price,rrp_price,currency,in_stock,merchant_category,colour\n' +
    '991,"Wool Coat, Camel",https://brand.com/p/991,https://brand.com/i.jpg,240.00,400.00,GBP,1,Coats,Camel\n');
  const r = t.feedRow({ name: "Brand", domain: "brand.com", feed_format: "awin", network: "awin" }, rows[0], "now");
  assert.strictEqual(r.title, "Wool Coat, Camel"); assert.strictEqual(r.price, 400); assert.strictEqual(r.sale_price, 240);
  assert.strictEqual(r.currency, "GBP"); assert.strictEqual(r.available, true); assert.strictEqual(r.colour, "camel");
});
ok("Google XML feed row (Rakuten / CJ / Impact style)", () => {
  const items = t.parseXmlItems('<rss><channel><item><g:id>A1</g:id><title><![CDATA[Silk Slip Dress & Belt]]></title><link>https://shop.com/a1</link>' +
    '<g:image_link>https://shop.com/a1.jpg</g:image_link><g:price>180.00 EUR</g:price><g:sale_price>120.00 EUR</g:sale_price>' +
    '<g:availability>out of stock</g:availability><g:product_type>Women &gt; Dresses</g:product_type></item></channel></rss>');
  const r = t.feedRow({ name: "Shop", domain: "shop.com", feed_format: "google" }, items[0], "now");
  assert.strictEqual(r.title, "Silk Slip Dress & Belt"); assert.strictEqual(r.currency, "EUR");
  assert.strictEqual(r.price, 180); assert.strictEqual(r.sale_price, 120); assert.strictEqual(r.available, false);
  assert.strictEqual(r.product_type, "Dresses");
});
ok("Affiliate links: Awin, Sovrn, Amazon, Impact, and direct with UTM", () => {
  const link = "https://staud.clothing/products/lynelle";
  const awin = buildAffiliateUrl({ link, click: "c-1", publisher_id: "AW9", merchant_id: "4321",
    deeplink: "https://www.awin1.com/cread.php?awinmid={merchant_id}&awinaffid={publisher_id}&clickref={click}&ued={url}" });
  assert.strictEqual(awin, "https://www.awin1.com/cread.php?awinmid=4321&awinaffid=AW9&clickref=c-1&ued=" + encodeURIComponent(link));
  const sov = buildAffiliateUrl({ link, click: "c-2", publisher_id: "K", deeplink: "https://redirect.viglink.com/?key={publisher_id}&cuid={click}&u={url}" });
  assert.ok(sov.startsWith("https://redirect.viglink.com/?key=K&cuid=c-2&u=https%3A%2F%2F"));
  const amz = buildAffiliateUrl({ link: "https://www.amazon.com/dp/B0X", click: "c-3", publisher_id: "persona-20", merchant_id: "B0X",
    deeplink: "https://www.amazon.com/dp/{merchant_id}?tag={publisher_id}&ascsubtag={click}" });
  assert.strictEqual(amz, "https://www.amazon.com/dp/B0X?tag=persona-20&ascsubtag=c-3");
  const imp = buildAffiliateUrl({ link, click: "c-4", publisher_id: "x", merchant_id: "https://staud.sjv.io/c/1/2/3", deeplink: "{merchant_id}?subId1={click}&u={url}" });
  assert.ok(imp.startsWith("https://staud.sjv.io/c/1/2/3?subId1=c-4&u="));
  const missing = buildAffiliateUrl({ link, click: "c-5", publisher_id: "AW9", merchant_id: null, deeplink: "https://www.awin1.com/cread.php?awinmid={merchant_id}" });
  assert.strictEqual(missing, link);
  assert.strictEqual(buildAffiliateUrl({ link }, { utm_source: "persona" }), link + "?utm_source=persona");
});
ok("Prices: money() and colour guessing", () => {
  assert.strictEqual(t.money("€1,299.00".replace(",", "")), 1299); assert.strictEqual(t.money("0"), null);
  assert.strictEqual(t.guessColour("Heather Gray Hoodie"), "grey");
});
console.log("\n" + n + " tests passed");
