-- Persona shop engine: product refresh, prices in US dollars, automatic Shop-the-look matches,
-- affiliate links with click tracking, and commission attribution per character and creator.
--
-- Paste this whole file into the Supabase SQL editor and press Run. Safe to run more than once.
-- Needs the persona_products table (already loaded with 1,938 products).

begin;

-- Image vectors (pgvector) for visual matching. Supabase includes it; this just switches it on.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- 1. Exchange rates. Prices are stored in the store's own currency and shown in US dollars.
--    The daily refresh replaces these starting values with that day's rates (European Central Bank).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.persona_fx_rates (
  currency     text primary key check (currency ~ '^[A-Z]{3}$'),
  usd_per_unit numeric(14,6) not null check (usd_per_unit > 0),
  updated_at   timestamptz not null default now()
);
insert into public.persona_fx_rates (currency, usd_per_unit) values
  ('USD', 1), ('EUR', 1.16), ('GBP', 1.33), ('CAD', 0.72), ('AUD', 0.66), ('SEK', 0.105),
  ('DKK', 0.155), ('NOK', 0.099), ('CHF', 1.25), ('JPY', 0.0066), ('KRW', 0.00072), ('NZD', 0.59)
on conflict (currency) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. Product columns for US-dollar prices, refresh tracking and search.
-- ---------------------------------------------------------------------------------------------
alter table public.persona_products add column if not exists price_usd      numeric(10,2);
alter table public.persona_products add column if not exists sale_price_usd numeric(10,2);
alter table public.persona_products add column if not exists first_seen_at  timestamptz not null default now();
alter table public.persona_products add column if not exists last_seen_at   timestamptz not null default now();
alter table public.persona_products add column if not exists colour         text;
alter table public.persona_products add column if not exists search         tsvector;
alter table public.persona_products add column if not exists embedding      extensions.vector(1024); -- image vector of the main photo
alter table public.persona_products add column if not exists embedded_at    timestamptz;
alter table public.persona_products add column if not exists embedded_image text;                     -- which photo the vector is for

-- Keeps US-dollar prices and the search index up to date whenever a product is added or changed.
create or replace function public.persona_products_prepare() returns trigger
language plpgsql set search_path = public as $$
declare rate numeric;
begin
  select usd_per_unit into rate from public.persona_fx_rates where currency = upper(coalesce(new.currency, 'USD'));
  new.price_usd      := case when rate is null then null else round(new.price * rate, 2) end;
  new.sale_price_usd := case when rate is null or new.sale_price is null then null else round(new.sale_price * rate, 2) end;
  new.search :=
       setweight(to_tsvector('simple', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(new.product_type, '') || ' ' || coalesce(new.colour, '')), 'A')
    || setweight(to_tsvector('simple', regexp_replace(array_to_string(new.tags, ' '), '[_:-]', ' ', 'g')), 'B')
    || setweight(to_tsvector('simple', left(coalesce(new.description, ''), 400)), 'C');
  return new;
end $$;
drop trigger if exists persona_products_prepare on public.persona_products;
create trigger persona_products_prepare before insert or update on public.persona_products
  for each row execute function public.persona_products_prepare();

-- Recalculate every US-dollar price (the daily refresh calls this after loading new rates).
create or replace function public.persona_apply_fx() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.persona_products p set
    price_usd      = round(p.price * r.usd_per_unit, 2),
    sale_price_usd = case when p.sale_price is null then null else round(p.sale_price * r.usd_per_unit, 2) end
  from public.persona_fx_rates r
  where r.currency = upper(coalesce(p.currency, 'USD'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Fill the new columns for the products already loaded (fires the trigger once per row).
update public.persona_products set currency = coalesce(currency, 'USD');

create index if not exists persona_products_search_idx on public.persona_products using gin (search);
create index if not exists persona_products_seen_idx   on public.persona_products (store_domain, last_seen_at);
create index if not exists persona_products_embedding_idx on public.persona_products
  using hnsw (embedding extensions.vector_cosine_ops);

-- Products whose photo has no vector yet (or changed since), for the nightly vector job.
create or replace function public.persona_products_to_embed(p_limit integer default 100)
returns table (id bigint, image text)
language sql stable security definer set search_path = public, extensions as $$
  select id, image from public.persona_products
  where available and image is not null and (embedding is null or embedded_image is distinct from image)
  order by on_sale desc, last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
-- Save vectors: [{"id": 1, "image": "https://...", "embedding": [0.1, ...]}, ...]
create or replace function public.persona_set_embeddings(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  update public.persona_products p set
    embedding = (r->>'embedding')::extensions.vector, embedded_image = r->>'image', embedded_at = now()
  from jsonb_array_elements(p_rows) r
  where p.id = (r->>'id')::bigint;
  get diagnostics n = row_count;
  return n;
end $$;
-- Closest-looking products to a garment cut-out's vector.
create or replace function public.persona_visual_candidates(p_embedding text, p_limit integer default 15)
returns table (id bigint, store text, title text, product_type text, colour text, price_usd numeric, on_sale boolean, image text, similarity real)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.store, p.title, p.product_type, p.colour, coalesce(p.sale_price_usd, p.price_usd), p.on_sale, p.image,
         (1 - (p.embedding <=> p_embedding::extensions.vector))::real
  from public.persona_products p
  where p.available and p.embedding is not null
  order by p.embedding <=> p_embedding::extensions.vector
  limit greatest(1, least(coalesce(p_limit, 15), 40));
$$;

-- Price history: one row every time a product's price changes.
create table if not exists public.persona_price_history (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references public.persona_products(id) on delete cascade,
  price       numeric(10,2),
  sale_price  numeric(10,2),
  currency    text,
  changed_at  timestamptz not null default now()
);
create index if not exists persona_price_history_product_idx on public.persona_price_history (product_id, changed_at desc);

create or replace function public.persona_products_price_log() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.price is distinct from old.price or new.sale_price is distinct from old.sale_price then
    insert into public.persona_price_history (product_id, price, sale_price, currency)
    values (new.id, new.price, new.sale_price, new.currency);
  end if;
  return new;
end $$;
drop trigger if exists persona_products_price_log on public.persona_products;
create trigger persona_products_price_log after update on public.persona_products
  for each row execute function public.persona_products_price_log();

-- ---------------------------------------------------------------------------------------------
-- 3. Where products come from. One row per brand. The daily refresh works through these.
--    kind 'shopify' = the brand's public product list; kind 'feed' = a product feed file from an
--    affiliate network (Awin, Rakuten, CJ, Impact...) or the brand itself.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.persona_sources (
  id           bigint generated always as identity primary key,
  name         text not null,
  domain       text not null unique,          -- matches persona_products.store_domain
  kind         text not null default 'shopify' check (kind in ('shopify', 'feed')),
  feed_url     text,                           -- for kind 'feed': the download link the network gives you
  feed_format  text check (feed_format in ('awin', 'google', 'custom')),
  feed_mapping jsonb,                          -- for feed_format 'custom': {"title": "<column>", ...}
  network      text,                           -- affiliate network that pays for this brand, e.g. 'awin'
  merchant_id  text,                           -- the brand's id on that network (Impact: the brand's tracking link)
  commission_rate numeric(5,4),                -- e.g. 0.12 for 12%, from the network's offer page (used by the link router)
  enabled      boolean not null default true,
  last_run_at  timestamptz,
  last_status  text,
  last_count   integer,
  created_at   timestamptz not null default now()
);
insert into public.persona_sources (name, domain)
select distinct on (store_domain) store, store_domain from public.persona_products order by store_domain, store
on conflict (domain) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 4. Affiliate networks. Paste your publisher id and switch a network on once you're approved.
--    {publisher_id}, {merchant_id}, {click} (our click id) and {url} (the product page, encoded)
--    are filled in for each click. 'sovrn' and 'skimlinks' cover brands that have no direct deal.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.persona_networks (
  network        text primary key,
  label          text not null,
  publisher_id   text,
  deeplink       text not null,
  catch_all      boolean not null default false,  -- can be used for any brand
  default_commission numeric(5,4) not null default 0.05, -- typical rate, used when a brand has none set
  enabled        boolean not null default false,
  postback_token text not null default replace(gen_random_uuid()::text, '-', ''),
  notes          text
);
insert into public.persona_networks (network, label, deeplink, catch_all, notes) values
  ('sovrn',     'Sovrn Commerce (VigLink)', 'https://redirect.viglink.com/?key={publisher_id}&cuid={click}&u={url}', true,
   'One sign-up, pays on thousands of stores automatically. Start here.'),
  ('skimlinks', 'Skimlinks', 'https://go.skimresources.com/?id={publisher_id}&xcust={click}&url={url}', true,
   'Like Sovrn: one sign-up covers most stores. Use one of the two, not both.'),
  ('awin',      'Awin (includes ShareASale)', 'https://www.awin1.com/cread.php?awinmid={merchant_id}&awinaffid={publisher_id}&clickref={click}&ued={url}', false,
   'Join each brand''s programme inside Awin, then put its advertiser id in persona_sources.merchant_id.'),
  ('rakuten',   'Rakuten Advertising', 'https://click.linksynergy.com/deeplink?id={publisher_id}&mid={merchant_id}&u1={click}&murl={url}', false,
   'publisher_id = your Rakuten site id; merchant_id = the brand''s MID.'),
  ('cj',        'CJ Affiliate', 'https://www.anrdoezrs.net/links/{publisher_id}/type/dlg/sid/{click}/{url_raw}', false,
   'publisher_id = your CJ PID (website id).'),
  ('impact',    'Impact', '{merchant_id}?subId1={click}&u={url}', false,
   'merchant_id = the brand''s tracking link from Impact, e.g. https://brand.sjv.io/c/123/456/789'),
  ('amazon',    'Amazon Associates', 'https://www.amazon.com/dp/{merchant_id}?tag={publisher_id}&ascsubtag={click}', false,
   'publisher_id = your Associates tag (ends in -20). Amazon items come in as offers: merchant_id = the ASIN.'),
  ('shopify_collabs', 'Shopify Collabs', '{merchant_id}', false,
   'Per-brand links from Shopify Collabs. merchant_id = your collab link for that brand. Sales are tracked by the brand.')
on conflict (network) do nothing;
alter table public.persona_networks add column if not exists default_commission numeric(5,4) not null default 0.05;
alter table public.persona_sources  add column if not exists commission_rate numeric(5,4);
update public.persona_networks set default_commission = 0.04 where network in ('sovrn', 'skimlinks') and default_commission = 0.05;
update public.persona_networks set default_commission = 0.03 where network = 'amazon' and default_commission = 0.05;

-- The same item sold somewhere else (another retailer, Amazon...). The link router compares these
-- with the brand's own link and sends the shopper to whichever pays the most.
create table if not exists public.persona_product_offers (
  id              bigint generated always as identity primary key,
  product_id      bigint not null references public.persona_products(id) on delete cascade,
  network         text not null references public.persona_networks(network),
  merchant_id     text,               -- e.g. the ASIN for Amazon, the retailer id for Rakuten/Awin
  url             text not null,      -- the product page at that retailer
  price_usd       numeric(10,2),
  commission_rate numeric(5,4),
  available       boolean not null default true,
  updated_at      timestamptz not null default now(),
  unique (product_id, network, url)
);

-- Payout rules. Change the numbers here any time.
create table if not exists public.persona_settings (
  key   text primary key,
  value numeric not null,
  notes text
);
insert into public.persona_settings (key, value, notes) values
  ('creator_cash_share', 0.5, 'Share of each commission paid to the character''s creator in cash (0.5 = 50%).'),
  ('points_per_usd',     10,  'Points a creator earns per $1 of commission. 10 points = 1 extra upload slot.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 5. Automatic Shop-the-look matches (found by the AI matcher) and the matcher's to-do list.
--    Hand-picked matches in persona_products.pin_ids keep working and are shown first.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.persona_look_items (
  id          bigint generated always as identity primary key,
  pin_id      text not null,                  -- images.id, e.g. 'imma-3' or 'up-...'
  product_id  bigint not null references public.persona_products(id) on delete cascade,
  garment     text,                           -- e.g. 'black silk tank top'
  score       real,
  source      text not null default 'auto' check (source in ('auto', 'manual')),
  hidden      boolean not null default false, -- set true to remove a bad match
  created_at  timestamptz not null default now(),
  unique (pin_id, product_id)
);
create index if not exists persona_look_items_pin_idx on public.persona_look_items (pin_id) where not hidden;

create table if not exists public.persona_look_jobs (
  pin_id     text primary key,
  status     text not null check (status in ('done', 'failed', 'no_garments')),
  garments   jsonb,
  error      text,
  tries      integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Live uploaded images that still need matching (for the matcher).
create or replace function public.persona_images_to_match(p_limit integer default 10)
returns table (pin_id text, image_url text, character_slug text)
language sql stable security definer set search_path = public as $$
  select i.id, i.url, i.character_slug
  from public.images i
  left join public.persona_look_jobs j on j.pin_id = i.id
  where i.live and i.url is not null
    and (j.pin_id is null or (j.status = 'failed' and j.tries < 3 and j.updated_at < now() - interval '6 hours'))
    and not exists (select 1 from public.persona_products p where p.pin_ids @> array[i.id])
  order by i.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- Product search for the matcher: words from the garment description, best matches first.
create or replace function public.persona_match_candidates(p_terms text, p_limit integer default 12)
returns table (id bigint, store text, title text, product_type text, colour text, price_usd numeric, on_sale boolean, image text, rank real)
language sql stable security definer set search_path = public as $$
  with q as (
    select to_tsquery('simple', string_agg(w || ':*', ' | ')) as tsq
    from (select distinct w from regexp_split_to_table(lower(coalesce(p_terms, '')), '[^a-z0-9]+') w where length(w) > 2) words
  )
  select p.id, p.store, p.title, p.product_type, p.colour, coalesce(p.sale_price_usd, p.price_usd), p.on_sale, p.image,
         ts_rank(p.search, q.tsq) + case when p.on_sale then 0.05 else 0 end
  from public.persona_products p, q
  where q.tsq is not null and p.available and p.image is not null and p.search @@ q.tsq
  order by 9 desc
  limit greatest(1, least(coalesce(p_limit, 12), 40));
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. What the closeup shows: hand-picked first, then automatic matches. Prices in US dollars.
-- ---------------------------------------------------------------------------------------------
create or replace function public.persona_shop_the_look(p_pin text, p_limit integer default 12)
returns table (id bigint, store text, title text, price_usd numeric, sale_price_usd numeric, on_sale boolean, image text, garment text)
language sql stable security definer set search_path = public as $$
  select id, store, title, price_usd, sale_price_usd, on_sale, image, garment from (
    select p.id, p.store, p.title, p.price_usd, p.sale_price_usd, p.on_sale, p.image, null::text as garment, 0 as tier, 1::real as score
    from public.persona_products p
    where p.pin_ids @> array[p_pin] and p.available
    union all
    select p.id, p.store, p.title, p.price_usd, p.sale_price_usd, p.on_sale, p.image, l.garment, 1, coalesce(l.score, 0)
    from public.persona_look_items l join public.persona_products p on p.id = l.product_id
    where l.pin_id = p_pin and not l.hidden and p.available
      and not p.pin_ids @> array[p_pin]
  ) x
  order by tier, score desc, id
  limit greatest(1, least(coalesce(p_limit, 12), 24));
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Clicks and commissions. Every "shop" click gets an id that is passed to the affiliate
--    network; when a sale comes back with that id we know which character and creator earned it.
--    No IP addresses or personal data are stored.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.persona_clicks (
  id             uuid primary key default gen_random_uuid(),
  product_id     bigint references public.persona_products(id) on delete set null,
  pin_id         text,
  character_slug text,
  creator_id     uuid references auth.users(id) on delete set null,
  store_domain   text,
  network        text,              -- which network's link was used ('direct' when none)
  created_at     timestamptz not null default now()
);
create index if not exists persona_clicks_creator_idx on public.persona_clicks (creator_id, created_at desc);
create index if not exists persona_clicks_character_idx on public.persona_clicks (character_slug, created_at desc);

create table if not exists public.persona_conversions (
  id              bigint generated always as identity primary key,
  click_id        uuid references public.persona_clicks(id) on delete set null,
  network         text not null,
  order_ref       text not null,
  sale_amount_usd numeric(12,2),
  commission_usd  numeric(12,2),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'reversed')),
  occurred_at     timestamptz not null default now(),
  raw             jsonb,
  unique (network, order_ref)
);
create index if not exists persona_conversions_click_idx on public.persona_conversions (click_id);

-- Who owns a character: the creator who made it, or the account it was assigned to.
create or replace function public.persona_character_owner(p_slug text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select owner from public.characters where slug = p_slug),
    (select id from public.creators where p_slug = any(characters) limit 1));
$$;

-- Link router, called by /api/go for each shop click. Looks at every way to buy this item that we
-- earn on (the brand's own network, other retailers selling it, catch-all networks), picks the one
-- that pays the most for this sale, logs the click and returns where to send the shopper.
create or replace function public.persona_log_click(p_product bigint, p_pin text default null, p_character text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  prod public.persona_products;
  src  public.persona_sources;
  best record;
  cid  uuid;
begin
  select * into prod from public.persona_products where id = p_product;
  if prod.id is null then return null; end if;
  select * into src from public.persona_sources where domain = prod.store_domain;

  select * into best from (
    -- the brand's own affiliate programme
    select n.network, n.deeplink, n.publisher_id, src.merchant_id, prod.link as link,
           coalesce(prod.sale_price_usd, prod.price_usd, 0) * coalesce(src.commission_rate, n.default_commission) as earn, 2 as pref
    from public.persona_networks n
    where n.enabled and n.publisher_id is not null and n.network = src.network
      and (src.merchant_id is not null or n.catch_all)
    union all
    -- the same item at another retailer (Amazon, a department store...)
    select n.network, n.deeplink, n.publisher_id, o.merchant_id, o.url,
           coalesce(o.price_usd, prod.sale_price_usd, prod.price_usd, 0) * coalesce(o.commission_rate, n.default_commission), 1
    from public.persona_product_offers o join public.persona_networks n on n.network = o.network
    where o.product_id = prod.id and o.available and n.enabled and n.publisher_id is not null
    union all
    -- catch-all networks that pay on most stores
    select n.network, n.deeplink, n.publisher_id, null, prod.link,
           coalesce(prod.sale_price_usd, prod.price_usd, 0) * n.default_commission, 0
    from public.persona_networks n
    where n.enabled and n.catch_all and n.publisher_id is not null
  ) options
  order by earn desc, pref desc
  limit 1;

  insert into public.persona_clicks (product_id, pin_id, character_slug, creator_id, store_domain, network)
  values (prod.id, left(p_pin, 80), left(p_character, 60),
          case when p_character is null then null else public.persona_character_owner(p_character) end,
          prod.store_domain, coalesce(best.network, 'direct'))
  returning id into cid;
  return jsonb_build_object('click', cid, 'link', coalesce(best.link, prod.link), 'network', best.network,
                            'deeplink', best.deeplink, 'publisher_id', best.publisher_id, 'merchant_id', best.merchant_id);
end $$;

-- What each creator earns: one row per sale, cash share plus points.
create table if not exists public.persona_creator_ledger (
  id              bigint generated always as identity primary key,
  creator_id      uuid not null references auth.users(id) on delete cascade,
  conversion_id   bigint not null unique references public.persona_conversions(id) on delete cascade,
  character_slug  text,
  cash_usd        numeric(12,2) not null default 0,
  points          integer not null default 0,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'reversed')),
  points_credited boolean not null default false,
  paid_at         timestamptz,              -- set when you pay the creator
  created_at      timestamptz not null default now()
);
create index if not exists persona_creator_ledger_creator_idx on public.persona_creator_ledger (creator_id, created_at desc);

-- Called by /api/postback when a network reports a sale. The token is persona_networks.postback_token.
create or replace function public.persona_record_conversion(
  p_network text, p_token text, p_click text, p_order text,
  p_sale numeric default null, p_commission numeric default null, p_currency text default 'USD',
  p_status text default 'pending', p_raw jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare rate numeric; cid uuid; st text; conv public.persona_conversions; clk public.persona_clicks;
        share numeric; ppu numeric; led public.persona_creator_ledger; lst text;
begin
  if not exists (select 1 from public.persona_networks where network = p_network and postback_token = p_token) then
    raise exception 'Unknown network or wrong token' using errcode = '28000';
  end if;
  if coalesce(p_order, '') = '' then raise exception 'order is required' using errcode = '22023'; end if;
  select usd_per_unit into rate from public.persona_fx_rates where currency = upper(coalesce(p_currency, 'USD'));
  if p_click ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into cid from public.persona_clicks where id = p_click::uuid;
  end if;
  st := case lower(coalesce(p_status, 'pending'))
          when 'approved' then 'approved' when 'confirmed' then 'approved' when 'locked' then 'approved'
          when 'paid' then 'paid' when 'reversed' then 'reversed' when 'declined' then 'reversed'
          when 'rejected' then 'reversed' else 'pending' end;
  insert into public.persona_conversions (click_id, network, order_ref, sale_amount_usd, commission_usd, status, raw)
  values (cid, p_network, left(p_order, 120), round(p_sale * coalesce(rate, 1), 2), round(p_commission * coalesce(rate, 1), 2), st, p_raw)
  on conflict (network, order_ref) do update set
    status = excluded.status,
    sale_amount_usd = coalesce(excluded.sale_amount_usd, persona_conversions.sale_amount_usd),
    commission_usd  = coalesce(excluded.commission_usd, persona_conversions.commission_usd),
    click_id        = coalesce(persona_conversions.click_id, excluded.click_id),
    raw = excluded.raw
  returning * into conv;

  -- Creator's share: cash plus points. Points go onto the creator's balance once the sale is approved,
  -- and come off again if the sale is later reversed.
  select * into clk from public.persona_clicks where id = conv.click_id;
  if clk.creator_id is not null then
    select value into share from public.persona_settings where key = 'creator_cash_share';
    select value into ppu   from public.persona_settings where key = 'points_per_usd';
    lst := case conv.status when 'reversed' then 'reversed' when 'pending' then 'pending' else 'approved' end;
    insert into public.persona_creator_ledger (creator_id, conversion_id, character_slug, cash_usd, points, status)
    values (clk.creator_id, conv.id, clk.character_slug,
            round(coalesce(conv.commission_usd, 0) * coalesce(share, 0.5), 2),
            floor(coalesce(conv.commission_usd, 0) * coalesce(ppu, 10)), lst)
    on conflict (conversion_id) do update set cash_usd = excluded.cash_usd, points = excluded.points, status = excluded.status
    returning * into led;
    if led.status = 'approved' and not led.points_credited then
      update public.creators set points = points + led.points where id = led.creator_id;
      update public.persona_creator_ledger set points_credited = true where id = led.id;
    elsif led.status = 'reversed' and led.points_credited then
      update public.creators set points = greatest(0, points - led.points) where id = led.creator_id;
      update public.persona_creator_ledger set points_credited = false where id = led.id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'matched_click', conv.click_id is not null, 'status', conv.status);
end $$;

-- For Studio: the signed-in creator's shop clicks, sales, cash and points, per character.
drop function if exists public.persona_my_earnings();
create or replace function public.persona_my_earnings()
returns table (character_slug text, clicks_30d bigint, clicks_total bigint, sales bigint,
               cash_owed_usd numeric, cash_pending_usd numeric, cash_paid_usd numeric, points_earned bigint)
language sql stable security definer set search_path = public as $$
  with c as (
    select character_slug, count(*) filter (where created_at > now() - interval '30 days') as c30, count(*) as ct
    from public.persona_clicks where creator_id = auth.uid() group by character_slug
  ), l as (
    select character_slug,
           count(*) filter (where status <> 'reversed') as sales,
           sum(cash_usd) filter (where status = 'approved' and paid_at is null) as owed,
           sum(cash_usd) filter (where status = 'pending') as pending,
           sum(cash_usd) filter (where status = 'approved' and paid_at is not null) as paid,
           sum(points) filter (where points_credited) as pts
    from public.persona_creator_ledger where creator_id = auth.uid() group by character_slug
  )
  select coalesce(c.character_slug, l.character_slug), coalesce(c.c30, 0), coalesce(c.ct, 0), coalesce(l.sales, 0),
         coalesce(l.owed, 0), coalesce(l.pending, 0), coalesce(l.paid, 0), coalesce(l.pts, 0)
  from c full join l on coalesce(l.character_slug, '') = coalesce(c.character_slug, '')
  order by 3 desc;
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Access. The public site can read products and matches and log clicks; everything else is
--    only reachable by the server (Vercel, with the Supabase secret key).
-- ---------------------------------------------------------------------------------------------
alter table public.persona_fx_rates      enable row level security;
alter table public.persona_price_history enable row level security;
alter table public.persona_sources       enable row level security;
alter table public.persona_networks      enable row level security;
alter table public.persona_look_items    enable row level security;
alter table public.persona_look_jobs     enable row level security;
alter table public.persona_clicks        enable row level security;
alter table public.persona_conversions   enable row level security;
alter table public.persona_product_offers enable row level security;
alter table public.persona_settings      enable row level security;
alter table public.persona_creator_ledger enable row level security;

drop policy if exists "rates are public" on public.persona_fx_rates;
create policy "rates are public" on public.persona_fx_rates for select using (true);
drop policy if exists "look items are public" on public.persona_look_items;
create policy "look items are public" on public.persona_look_items for select using (not hidden);

grant select on public.persona_fx_rates, public.persona_look_items to anon, authenticated;
grant all on public.persona_products, public.persona_fx_rates, public.persona_price_history, public.persona_sources,
  public.persona_networks, public.persona_look_items, public.persona_look_jobs, public.persona_clicks,
  public.persona_conversions, public.persona_product_offers, public.persona_settings,
  public.persona_creator_ledger to service_role;

revoke all on function public.persona_apply_fx(), public.persona_images_to_match(integer),
  public.persona_match_candidates(text, integer), public.persona_character_owner(text),
  public.persona_products_to_embed(integer), public.persona_set_embeddings(jsonb),
  public.persona_visual_candidates(text, integer) from public, anon, authenticated;
grant execute on function public.persona_apply_fx(), public.persona_images_to_match(integer),
  public.persona_match_candidates(text, integer), public.persona_character_owner(text),
  public.persona_products_to_embed(integer), public.persona_set_embeddings(jsonb),
  public.persona_visual_candidates(text, integer) to service_role;

grant execute on function public.persona_shop_the_look(text, integer) to anon, authenticated, service_role;
grant execute on function public.persona_log_click(bigint, text, text) to anon, authenticated, service_role;
grant execute on function public.persona_record_conversion(text, text, text, text, numeric, numeric, text, text, jsonb) to anon, authenticated, service_role;
revoke all on function public.persona_my_earnings() from public, anon;
grant execute on function public.persona_my_earnings() to authenticated;

commit;

-- Done. Check it worked: this should show prices in US dollars for the euro and pound brands.
select store, currency, price, price_usd from public.persona_products
where currency <> 'USD' order by store limit 6;
