# Persona shop engine

This explains how Persona makes money from "Shop the look", in plain English, and what you need to switch it on.

## What it does

```
New image ──► Garment finder ──► Visual match ──► Shop the look ──► Link router ──► Store ──► Sale ──► Creator payout
               (AI cuts out       (closest real     (on every         (best-paying     (the       (reported   (cash + points)
                each item)         items by look)    image)            link wins)       shopper    back by
                                                                                         buys)      network)
     ▲
     └── Catalog: brand products, prices and stock refreshed every night, each photo turned into an image vector
```

| Part | What happens | Where it lives |
|---|---|---|
| **Catalog** | Every brand's products, with photos, prices, sizes and stock. Each product photo gets an image vector, a list of numbers describing how it looks, so similar-looking items can be found. | `persona_products` |
| **Daily refresh** | Every morning (7:00 UTC) the site re-reads each brand's public product list and any affiliate feed files. New items are added, prices update, sold-out items are hidden, and price changes are kept in history. It follows each store's robots.txt rules and waits between requests. | `api/cron/refresh-products.js` |
| **Prices in dollars** | Prices are stored in the store's own currency, but always shown in US dollars, using that day's European Central Bank rates. This fixes House of Sunny (pounds), Paloma Wool and Rouje (euros). | `persona_fx_rates` |
| **Garment finder** | When a creator publishes a new image, the AI (Claude) lists each piece of clothing and where it is in the picture, and the site cuts each one out. | `api/_lib/matcher.js` |
| **Visual match** | Each cut-out is compared with every product photo by look, and with product names by words. The AI then picks the closest 3 real items for each garment. Your hand-picked matches always come first. | `api/cron/match-looks.js` (8:30 UTC daily) |
| **Link router** | Every Shop click goes through `/api/go`. It checks every way we could earn on that item (the brand's own programme, the same item at another retailer or on Amazon, catch-all networks) and uses the one that pays the most. | `persona_log_click` |
| **Sale tracking** | Each click gets an ID that goes to the network. When someone buys, the network reports the sale back with that ID, so we know which image, character and creator earned it. No personal data is stored. | `/api/postback`, `persona_clicks`, `persona_conversions` |
| **Creator payout** | The creator gets **50% of the commission in cash** plus **10 points per $1** of commission, and points unlock extra uploads. Points are added once the store confirms the sale, and taken back if the sale is cancelled. Creators see their earnings in Studio. | `persona_creator_ledger`, `persona_settings` |

## Switching it on (one time)

1. **Run the SQL.** Open Supabase → SQL Editor, paste all of `supabase/shop-engine.sql` and press Run. At the bottom you should see House of Sunny prices with a `price_usd` column.
2. **Add these settings in Vercel** (Project → Settings → Environment Variables), then redeploy:

   | Name | What to put | Needed for |
   |---|---|---|
   | `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → **Secret key** (starts with `sb_secret_`). Keep it private. | Saving refreshed products, matches and vectors |
   | `CRON_SECRET` | Any long random password you make up. Vercel uses it automatically so only Vercel can start the nightly jobs. | The nightly jobs |
   | `ANTHROPIC_API_KEY` | Your Claude API key from console.anthropic.com | Garment finder and matching |
   | `VOYAGE_API_KEY` | A key from voyageai.com (image vectors) | Visual match. Without it, matching uses words only. |

The site works before any of this: prices fall back to the old display and links still go to the store. Each piece switches on when its setting is added.

**Costs, roughly:** matching uses two AI calls per new image (a few cents each). Making vectors for all ~2,000 products the first time costs about a dollar, and after that only new products need them.

## Affiliate accounts, in the order to apply

You earn nothing on a click until at least one network is switched on. Apply in this order:

1. **Sovrn Commerce *or* Skimlinks (pick one).** One sign-up and it pays on thousands of stores automatically, including most of our 20 brands. Fastest way to start earning. Typical rate is about 4 to 8%, after the network's cut.
2. **Rakuten Advertising.** Many fashion brands and department stores.
3. **Awin** (now includes ShareASale). Strong for UK and European brands.
4. **Impact.** Many direct-to-consumer brands run their programmes here.
5. **CJ Affiliate.** Department stores and bigger labels.
6. **Amazon Associates.** Good for basics and accessories. Note: Amazon closes new accounts that don't make 3 sales within 180 days, so apply once traffic is steady.
7. **Shopify Collabs.** Direct deals with Shopify brands (most of ours are on Shopify), usually at higher rates.

Each network asks for your website (https://persona-ai-characters.vercel.app) and a short description, and approves you in a few days. After approval you apply to each brand's programme inside Rakuten, Awin, Impact and CJ.

### Turning a network on

In Supabase → Table Editor → `persona_networks`, find the network's row:
- put your publisher / site ID in `publisher_id` (Amazon: your tag ending in `-20`)
- tick `enabled`

For a brand you've joined on Rakuten, Awin, CJ or Impact, open `persona_sources`, find the brand and set:
- `network`: e.g. `awin`
- `merchant_id`: the brand's ID on that network (Impact: the brand's tracking link)
- `commission_rate`: e.g. `0.12` for 12%, so the router knows what it pays

### Getting sales reported back

In each network's dashboard, find "postback URL", "conversion webhook" or "transaction notification" and paste:

```
https://persona-ai-characters.vercel.app/api/postback?network=NETWORK&token=TOKEN&click={SUBID}&order={ORDER_ID}&sale={SALE_AMOUNT}&commission={COMMISSION}&currency={CURRENCY}&status={STATUS}
```

Replace `NETWORK` with the row name (e.g. `awin`) and `TOKEN` with that row's `postback_token` from `persona_networks`. The `{...}` parts are the network's own placeholders, so use whatever names its form lists. Sovrn and Skimlinks also offer a daily report you can upload instead.

### Feeds instead of store pages

Some brands don't publish a product list, and networks give you a product feed file instead. Add a row to `persona_sources` with `kind` = `feed`, `feed_url` = the download link the network gives you, and `feed_format` = `awin` for Awin, or `google` for Rakuten, CJ, Impact and most brand feeds. The nightly refresh picks it up.

## Paying creators

`persona_creator_ledger` has one row per sale. When you pay a creator (PayPal, bank transfer...), set `paid_at` on their approved rows. To change the split or the points, edit `persona_settings`: `creator_cash_share` (0.5 = 50%) and `points_per_usd` (10).

## Checking it's working

- Vercel → Project → Cron Jobs shows each nightly run and its report: stores refreshed, products, vectors and matches.
- `persona_sources.last_status` shows each brand's last refresh result (for example `ok`, or `robots.txt says no`).
- `persona_look_items` lists automatic matches. Set `hidden` to true to remove a bad one.
- `persona_clicks` fills up as people click Shop.

## Not built yet

- Brand deals: paid placement and product drops.
- Fetching Amazon prices automatically. Amazon's product API only opens after your first sales, so until then Amazon items are added as offers by hand or from a feed.
- Paying creators automatically. For now you see what's owed and pay by hand.
- Live currency choice for shoppers outside the US. Everything shows in dollars for now.
