-- persona_products: shoppable items pulled from brand stores (first source: Shopify /products.json).
-- Run once in the Supabase SQL editor (safe to re-run).
create table if not exists public.persona_products (
  id            bigint generated always as identity primary key,
  store         text not null,              -- brand / store name, e.g. "Kith"
  store_domain  text not null,              -- e.g. "kith.com"
  source        text not null default 'shopify',
  external_id   text not null,              -- product id at the store
  title         text not null,
  product_type  text,
  tags          text[] not null default '{}',
  price         numeric(10,2),              -- regular (full) price
  sale_price    numeric(10,2),              -- set only when the item is discounted
  currency      text,
  on_sale       boolean generated always as (sale_price is not null and sale_price < price) stored,
  link          text not null,              -- product page
  image         text,                       -- main product image
  images        text[] not null default '{}', -- up to 6 product images
  description   text,
  vendor        text,
  sizes         text[] not null default '{}',
  published_at  timestamptz,                -- when the store published it (we keep the latest)
  pin_ids       text[] not null default '{}', -- site images this item is shown with (loose link for now)
  available     boolean not null default true,
  fetched_at    timestamptz not null default now(),
  unique (store_domain, external_id)
);
-- An image fingerprint for visual search can be added later:
--   create extension if not exists vector;
--   alter table public.persona_products add column embedding vector(512);

create index if not exists persona_products_store_idx on public.persona_products (store_domain);
create index if not exists persona_products_pins_idx  on public.persona_products using gin (pin_ids);
create index if not exists persona_products_sale_idx  on public.persona_products (on_sale) where on_sale;

alter table public.persona_products enable row level security;
drop policy if exists "products are public" on public.persona_products;
create policy "products are public" on public.persona_products for select using (true);
grant select on public.persona_products to anon, authenticated;
