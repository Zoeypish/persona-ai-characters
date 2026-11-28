-- Persona: character blocks and the Combine screen.
-- Paste this whole file into the Supabase SQL editor and press Run. Safe to run more than once.
-- Needs the earlier setup files (creator-api.sql, accounts-and-safety.sql), which are already live.
--
-- What it adds:
--   1. blocks: small typed JSON pieces (face, body, hair, wardrobe, camera, light, location, mood, pose), each with a
--      preview image, author and version. Addressed like face@sienna/v2. A saved version never changes.
--   2. combos: characters built from blocks (a recipe that points to block addresses), with a remix_of link (family tree).
--   3. block_uses + points: when someone else uses your block for the first time, you get 1 point.
--   4. block_reports: 3 reports from different people hide a block until an admin decides (same rule as images).
--   5. The Persona starter blocks.

-- =====================================================================================
-- 1. Blocks
-- =====================================================================================
create table if not exists public.blocks (
  address     text primary key,                         -- type@name/vN, e.g. face@sienna/v2
  type        text not null check (type in ('face','body','hair','wardrobe','camera','light','location','mood','pose')),
  name        text not null check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(name) <= 40),
  version     integer not null check (version between 1 and 9999),
  title       text not null check (length(btrim(title)) between 1 and 60),
  data        jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 8000),
  preview_url text check (preview_url is null or preview_url ~ '^(https://[^\s"''<>]+|images/[A-Za-z0-9._-]+)$'),
  tags        text[] not null default '{}' check (cardinality(tags) <= 8),
  remix_of    text references public.blocks(address) on delete set null,
  likeness    text check (likeness is null or likeness = 'invented'),
  author      uuid references auth.users(id) on delete cascade,   -- null = Persona starter block
  author_name text check (author_name is null or length(author_name) <= 80),
  visibility  text not null default 'public' check (visibility in ('public', 'private')),
  moderation  text not null default 'ok' check (moderation in ('ok', 'review', 'removed')),
  uses        integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (type, name, version),
  check (address = type || '@' || name || '/v' || version),
  check (type <> 'face' or likeness = 'invented')       -- likeness rule: every face must be confirmed as invented
);
create index if not exists blocks_type_uses on public.blocks (type, uses desc);
create index if not exists blocks_author on public.blocks (author);
alter table public.blocks enable row level security;

-- Everyone sees public blocks that aren't hidden. Authors always see their own. Admins see everything.
drop policy if exists "public blocks" on public.blocks;
create policy "public blocks" on public.blocks for select
  using ((visibility = 'public' and moderation = 'ok') or author = auth.uid() or public.is_admin());
revoke all on public.blocks from anon, authenticated;
grant select on public.blocks to anon, authenticated;   -- writes only go through the functions below

-- Publish a block (or a new version of one you own). Returns the saved block.
create or replace function public.block_publish(p_block jsonb, p_visibility text default 'public')
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t text; n text; v int; owner_ uuid; rem text; r blocks; who text;
begin
  if uid is null then raise exception 'Please sign in first.' using errcode = '28000'; end if;
  if p_block is null or jsonb_typeof(p_block) <> 'object' then raise exception 'That isn''t a block.' using errcode = '22023'; end if;
  t := p_block->>'type'; n := p_block->>'name';
  if t is null or t not in ('face','body','hair','wardrobe','camera','light','location','mood','pose') then
    raise exception 'A block needs a type: face, body, hair, wardrobe, camera, light, location, mood or pose.' using errcode = '22023'; end if;
  if n is null or n !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(n) > 40 then
    raise exception 'Give the block a short name, like sienna or golden-hour.' using errcode = '22023'; end if;
  if t = 'face' and coalesce(p_block->>'likeness', '') <> 'invented' then
    raise exception 'Face blocks must be invented faces. Tick the box to confirm it isn''t a real person.' using errcode = '22023'; end if;
  if (select count(*) from blocks where author = uid and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'That''s a lot of blocks in one hour. Please try again a bit later.' using errcode = '54000'; end if;

  perform pg_advisory_xact_lock(hashtext('block:' || t || '@' || n));
  -- A name belongs to whoever published it first. Others remix it under a new name.
  select author into owner_ from blocks where type = t and name = n order by version limit 1;
  if found and owner_ is distinct from uid then
    raise exception 'The name %@% is taken. Pick another name (a remix keeps the link to the original).', t, n using errcode = '23505'; end if;
  select coalesce(max(version), 0) + 1 into v from blocks where type = t and name = n;

  rem := p_block->>'remix_of';
  if rem is not null and not exists (select 1 from blocks where address = rem and ((visibility = 'public' and moderation = 'ok') or author = uid)) then rem := null; end if;
  if rem is null and v > 1 then rem := t || '@' || n || '/v' || (v - 1); end if;   -- a new version points to the one before
  select coalesce(nullif(btrim(username), ''), name) into who from creators where id = uid;

  insert into blocks (address, type, name, version, title, data, preview_url, tags, remix_of, likeness, author, author_name, visibility)
  values (t || '@' || n || '/v' || v, t, n, v,
    left(coalesce(nullif(btrim(p_block->>'title'), ''), n), 60),
    coalesce(p_block->'data', '{}'::jsonb),
    nullif(coalesce(p_block->>'preview', p_block->>'preview_url'), ''),
    coalesce((select array_agg(left(x, 24)) from (select jsonb_array_elements_text(case when jsonb_typeof(p_block->'tags') = 'array' then p_block->'tags' else '[]'::jsonb end) x limit 8) s), '{}'),
    rem, case when t = 'face' then 'invented' end, uid, left(who, 80),
    case when p_visibility = 'private' then 'private' else 'public' end)
  returning * into r;
  return to_jsonb(r);
end $$;

-- Show or hide one of your blocks (hidden blocks stay usable by characters already made with them).
create or replace function public.block_set_visibility(p_address text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_visibility not in ('public', 'private') then raise exception 'Use public or private.' using errcode = '22023'; end if;
  update blocks set visibility = p_visibility where address = p_address and author = auth.uid();
  if not found then raise exception 'Block not found.' using errcode = '42501'; end if;
end $$;

-- =====================================================================================
-- 2. Combos (characters made from blocks) and credit for block authors
-- =====================================================================================
create table if not exists public.combos (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references auth.users(id) on delete cascade,
  name           text check (name is null or length(name) <= 60),
  character_slug text,                                     -- the character it was saved to, if any
  blocks         jsonb not null check (jsonb_typeof(blocks) = 'object' and pg_column_size(blocks) < 2000),
  remix_of       uuid references public.combos(id) on delete set null,
  created_at     timestamptz not null default now()
);
alter table public.combos enable row level security;
drop policy if exists "combos are public" on public.combos;
create policy "combos are public" on public.combos for select using (true);  -- only block addresses, so the family tree is open
revoke all on public.combos from anon, authenticated;
grant select on public.combos to anon, authenticated;

create table if not exists public.block_uses (
  address    text not null references public.blocks(address) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  combo_id   uuid references public.combos(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (address, user_id)                         -- one use (and at most one point) per person per block
);
alter table public.block_uses enable row level security;
revoke all on public.block_uses from anon, authenticated;

-- Save a combo. Each block's author gets 1 point the first time another person uses it (max 50 points a day per author).
create or replace function public.combo_save(p_blocks jsonb, p_name text default null, p_slug text default null, p_remix_of uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); k text; a text; b blocks; cid uuid; credited int := 0; inserted int;
begin
  if uid is null then raise exception 'Please sign in first.' using errcode = '28000'; end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'object' or p_blocks = '{}'::jsonb then
    raise exception 'Pick at least one block.' using errcode = '22023'; end if;
  if p_slug is not null and not exists (select 1 from creators where id = uid and p_slug = any(characters)) then
    raise exception 'You don''t own a character called "%".', p_slug using errcode = '42501'; end if;
  if (select count(*) from combos where owner = uid and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That''s a lot of saves in one hour. Please try again a bit later.' using errcode = '54000'; end if;
  for k, a in select key, value #>> '{}' from jsonb_each(p_blocks) loop
    select * into b from blocks where address = a;
    if not found or b.type <> k then raise exception 'Block % wasn''t found.', a using errcode = '22023'; end if;
    if b.moderation <> 'ok' or (b.visibility <> 'public' and b.author is distinct from uid) then
      raise exception 'Block % isn''t available any more.', a using errcode = '42501'; end if;
  end loop;
  if p_remix_of is not null and not exists (select 1 from combos where id = p_remix_of) then p_remix_of := null; end if;
  insert into combos (owner, name, character_slug, blocks, remix_of)
    values (uid, nullif(left(btrim(coalesce(p_name, '')), 60), ''), p_slug, p_blocks, p_remix_of) returning id into cid;
  for a in select value #>> '{}' from jsonb_each(p_blocks) loop
    insert into block_uses (address, user_id, combo_id) values (a, uid, cid) on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      update blocks set uses = uses + 1 where address = a returning * into b;
      if b.author is not null and b.author <> uid and
         (select count(*) from block_uses u join blocks x on x.address = u.address
           where x.author = b.author and u.user_id <> b.author and u.created_at > now() - interval '1 day') <= 50 then
        update creators set points = points + 1 where id = b.author;
        credited := credited + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('id', cid, 'credited_authors', credited);
end $$;

-- =====================================================================================
-- 3. Reports (same 3-strikes rule as images, reviewed on review.html)
-- =====================================================================================
create table if not exists public.block_reports (
  id          uuid primary key default gen_random_uuid(),
  address     text not null references public.blocks(address) on delete cascade,
  reason      text not null check (reason in ('real_person', 'copyright', 'sexual', 'minor', 'hate', 'spam', 'other')),
  details     text check (details is null or length(details) <= 1000),
  reporter    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status      text not null default 'open' check (status in ('open', 'kept', 'removed')),
  created_at  timestamptz not null default now(),
  unique (address, reporter)
);
alter table public.block_reports enable row level security;
drop policy if exists "admins read block reports" on public.block_reports;
create policy "admins read block reports" on public.block_reports for select to authenticated using (public.is_admin());
revoke all on public.block_reports from anon, authenticated;
grant select on public.block_reports to authenticated;

create or replace function public.block_report(p_address text, p_reason text, p_details text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in to report.' using errcode = '28000'; end if;
  insert into block_reports (address, reason, details) values (p_address, p_reason, nullif(left(btrim(coalesce(p_details, '')), 1000), ''))
    on conflict (address, reporter) do nothing;
  if (select count(distinct reporter) from block_reports where address = p_address and status = 'open') >= 3 then
    update blocks set moderation = 'review' where address = p_address and moderation = 'ok';
  end if;
end $$;

-- Admin decision: 'keep' (show again), 'remove' (take down for good), 'review' (hide now).
create or replace function public.block_moderate(p_address text, p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Persona admins can do this.' using errcode = '42501'; end if;
  if p_action not in ('keep', 'remove', 'review') then raise exception 'Unknown action.' using errcode = '22023'; end if;
  update blocks set moderation = case p_action when 'keep' then 'ok' when 'remove' then 'removed' else 'review' end where address = p_address;
  if p_action <> 'review' then
    update block_reports set status = case p_action when 'keep' then 'kept' else 'removed' end where address = p_address and status = 'open';
  end if;
end $$;

revoke execute on function public.block_publish(jsonb, text), public.block_set_visibility(text, text),
  public.combo_save(jsonb, text, text, uuid), public.block_report(text, text, text), public.block_moderate(text, text) from public, anon;
grant execute on function public.block_publish(jsonb, text), public.block_set_visibility(text, text),
  public.combo_save(jsonb, text, text, uuid), public.block_report(text, text, text), public.block_moderate(text, text) to authenticated;

-- =====================================================================================
-- 4. Persona starter blocks (made by scripts/build-blocks.js from templates/blocks.json)
-- =====================================================================================
-- STARTERS BEGIN
insert into public.blocks (address, type, name, version, title, data, preview_url, tags, remix_of, likeness, author_name) values
  ('face@sienna/v1', 'face', 'sienna', 1, 'Sienna', '{"age_range":"mid 20s","face":"soft oval face, high cheekbones, full lips","eyes":"hazel almond-shaped","skin":"warm olive skin","signature_detail":"a small beauty mark under the left eye","never_change":["beauty mark under left eye","hazel eyes"]}'::jsonb, null, array['soft','warm']::text[], null, 'invented', 'Persona'),
  ('face@sienna/v2', 'face', 'sienna', 2, 'Sienna', '{"age_range":"mid 20s","face":"soft oval face, high cheekbones, full lips","eyes":"hazel almond-shaped","skin":"warm olive skin with light freckles across the nose","signature_detail":"a small beauty mark under the left eye","never_change":["beauty mark under left eye","hazel eyes","nose freckles"]}'::jsonb, null, array['soft','warm','freckles']::text[], 'face@sienna/v1', 'invented', 'Persona'),
  ('face@juno/v1', 'face', 'juno', 1, 'Juno', '{"age_range":"early 20s","face":"angular face, strong jaw, straight brows","eyes":"dark brown hooded","skin":"deep brown skin with a satin finish","signature_detail":"a thin gold septum ring","never_change":["septum ring","straight brows"]}'::jsonb, null, array['bold','graphic']::text[], null, 'invented', 'Persona'),
  ('face@mika/v1', 'face', 'mika', 1, 'Mika', '{"age_range":"early 20s","face":"round face, button nose, dimples when smiling","eyes":"dark monolid","skin":"light golden skin","signature_detail":"two tiny star tattoos by the right eye","never_change":["star tattoos by right eye","dimples"]}'::jsonb, null, array['playful','round']::text[], null, 'invented', 'Persona'),
  ('face@odette/v1', 'face', 'odette', 1, 'Odette', '{"age_range":"early 30s","face":"long face, defined cheekbones, narrow nose","eyes":"pale grey-blue","skin":"fair skin with a cool undertone","signature_detail":"a faint scar through the right eyebrow","never_change":["eyebrow scar","grey-blue eyes"]}'::jsonb, null, array['classic','elegant']::text[], null, 'invented', 'Persona'),
  ('face@rafe/v1', 'face', 'rafe', 1, 'Rafe', '{"age_range":"late 20s","face":"square face, short stubble, broad nose","eyes":"warm brown","skin":"tan skin","signature_detail":"a chipped front tooth that shows when he grins","never_change":["chipped front tooth","stubble"]}'::jsonb, null, array['rugged','warm']::text[], null, 'invented', 'Persona'),
  ('face@tavi/v1', 'face', 'tavi', 1, 'Tavi', '{"age_range":"mid 20s","face":"heart-shaped face, sharp chin, thick dark brows","eyes":"green, slightly upturned","skin":"pale skin with rosy cheeks","signature_detail":"a silver ear cuff on the left ear","never_change":["left ear cuff","green eyes"]}'::jsonb, null, array['androgynous','cool']::text[], null, 'invented', 'Persona'),
  ('hair@pink-bob/v1', 'hair', 'pink-bob', 1, 'Pink bob', '{"colour":"pastel pink","length":"chin-length","cut":"blunt bob with a fringe","texture":"glossy and straight"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('hair@silver-crop/v1', 'hair', 'silver-crop', 1, 'Silver crop', '{"colour":"silver","length":"short","cut":"textured pixie crop","texture":"matte"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('hair@long-waves/v1', 'hair', 'long-waves', 1, 'Long waves', '{"colour":"dark chocolate brown","length":"long","cut":"loose layers","texture":"soft beachy waves"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('hair@box-braids/v1', 'hair', 'box-braids', 1, 'Box braids', '{"colour":"black with honey-blonde ends","length":"waist-length","cut":"box braids, often in a high ponytail"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('hair@buzz/v1', 'hair', 'buzz', 1, 'Buzz cut', '{"colour":"bleached platinum","length":"very short","cut":"even buzz cut"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('body@tall-slim/v1', 'body', 'tall-slim', 1, 'Tall and slim', '{"build":"slim, long-limbed","height":"tall, about 178 cm"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('body@petite/v1', 'body', 'petite', 1, 'Petite', '{"build":"petite and small-framed","height":"about 158 cm"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('body@athletic/v1', 'body', 'athletic', 1, 'Athletic', '{"build":"athletic with toned shoulders","height":"about 170 cm"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('body@curvy/v1', 'body', 'curvy', 1, 'Curvy', '{"build":"soft curves, full hips","height":"about 165 cm"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('wardrobe@minimal-mono/v1', 'wardrobe', 'minimal-mono', 1, 'Minimal mono', '{"outfit":"oversized black blazer, crisp white tee, straight black trousers, leather loafers","style":["minimal","monochrome"],"palette":["black","white","chrome"]}'::jsonb, null, array['minimal']::text[], null, null, 'Persona'),
  ('wardrobe@street-layers/v1', 'wardrobe', 'street-layers', 1, 'Street layers', '{"outfit":"boxy hoodie under a cropped puffer, cargo pants, chunky sneakers, a beanie","style":["streetwear","layered"],"palette":["olive","grey","orange"]}'::jsonb, null, array['streetwear']::text[], null, null, 'Persona'),
  ('wardrobe@boho-linen/v1', 'wardrobe', 'boho-linen', 1, 'Boho linen', '{"outfit":"loose cream linen dress, woven belt, leather sandals, stacked gold bangles","style":["boho","relaxed"],"palette":["cream","sand","terracotta"]}'::jsonb, null, array['boho']::text[], null, null, 'Persona'),
  ('wardrobe@y2k-party/v1', 'wardrobe', 'y2k-party', 1, 'Y2K party', '{"outfit":"silver halter top, low-rise satin mini skirt, platform boots, tinted sunglasses","style":["y2k","party"],"palette":["silver","baby pink","lilac"]}'::jsonb, null, array['y2k','party']::text[], null, null, 'Persona'),
  ('wardrobe@tailored-noir/v1', 'wardrobe', 'tailored-noir', 1, 'Tailored noir', '{"outfit":"long charcoal wool coat, black turtleneck, wide-leg trousers, pointed ankle boots","style":["tailored","dark"],"palette":["charcoal","black","oxblood"]}'::jsonb, null, array['tailored']::text[], null, null, 'Persona'),
  ('mood@noir/v1', 'mood', 'noir', 1, 'Noir', '{"feeling":"moody and mysterious","expression":"a cool, unreadable look","grade":"deep shadows, desaturated colour, fine film grain","keywords":["noir","cinematic"]}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('mood@dreamy/v1', 'mood', 'dreamy', 1, 'Dreamy', '{"feeling":"soft and dreamy","expression":"eyes half closed, gentle smile","grade":"hazy pastel tones, soft bloom","keywords":["dreamy","soft"]}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('mood@playful/v1', 'mood', 'playful', 1, 'Playful', '{"feeling":"playful and high-energy","expression":"big open laugh","grade":"bright saturated colour, punchy contrast","keywords":["playful","fun"]}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('mood@editorial-cool/v1', 'mood', 'editorial-cool', 1, 'Editorial cool', '{"feeling":"confident and detached","expression":"neutral face, chin slightly raised","grade":"clean, crisp, magazine colour","keywords":["editorial"]}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('mood@nostalgic/v1', 'mood', 'nostalgic', 1, 'Nostalgic', '{"feeling":"warm and nostalgic","expression":"a small wistful smile","grade":"warm faded film tones, slight light leaks","keywords":["vintage","film"]}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@35-full/v1', 'camera', '35-full', 1, '35mm full body', '{"description":"full-body shot on a 35mm lens at eye level, head to shoes in frame","full_outfit":true,"preset":"cam-35-full"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@50-three-quarter/v1', 'camera', '50-three-quarter', 1, '50mm three-quarter', '{"description":"three-quarter length shot on a 50mm lens, from mid-thigh up, eye level","full_outfit":true,"preset":"cam-50-three-quarter"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@85-portrait/v1', 'camera', '85-portrait', 1, '85mm portrait', '{"description":"head-and-shoulders portrait on an 85mm lens, shallow depth of field, eyes in sharp focus","preset":"cam-85-portrait"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@24-wide/v1', 'camera', '24-wide', 1, '24mm wide scene', '{"description":"wide 24mm shot, the character full length and small in a large scene, environment visible","full_outfit":true,"preset":"cam-24-wide"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@low-hero/v1', 'camera', 'low-hero', 1, 'Low angle hero', '{"description":"low-angle full-body shot looking slightly up, 35mm lens, strong confident framing","full_outfit":true,"preset":"cam-low-hero"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@high-flatlay/v1', 'camera', 'high-flatlay', 1, 'Overhead', '{"description":"shot from directly above, full body visible, graphic composition","full_outfit":true,"preset":"cam-high-flatlay"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@across-street/v1', 'camera', 'across-street', 1, 'Across the street', '{"description":"candid telephoto shot from across the street, 135mm lens, full outfit visible, passers-by soft in the foreground","full_outfit":true,"preset":"cam-across-street"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@mirror/v1', 'camera', 'mirror', 1, 'Mirror selfie', '{"description":"mirror selfie, phone held at chest height, full length reflection, slight wide-angle phone look","full_outfit":true,"preset":"cam-mirror"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@detail/v1', 'camera', 'detail', 1, 'Detail close-up', '{"description":"macro close-up of one accessory or shoe, the outfit soft behind it, 100mm lens","full_outfit":true,"preset":"cam-detail"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('camera@film-snapshot/v1', 'camera', 'film-snapshot', 1, 'Film snapshot', '{"description":"point-and-shoot film snapshot with direct flash, 28mm, slightly off-centre, full outfit visible","full_outfit":true,"preset":"cam-film-snapshot"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('light@golden/v1', 'light', 'golden', 1, 'Golden hour', '{"description":"warm golden-hour sunlight from the side, long soft shadows","preset":"light-golden"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('light@overcast/v1', 'light', 'overcast', 1, 'Soft overcast', '{"description":"soft even overcast daylight, true-to-life colours","preset":"light-overcast"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('light@window/v1', 'light', 'window', 1, 'Window light', '{"description":"soft natural window light from one side, gentle falloff","preset":"light-window"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('light@studio/v1', 'light', 'studio', 1, 'Clean studio', '{"description":"clean studio lighting, large softbox, seamless backdrop","preset":"light-studio"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('light@flash-night/v1', 'light', 'flash-night', 1, 'Night flash', '{"description":"night-time on-camera flash, dark background, crisp highlights","preset":"light-flash-night"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('light@neon/v1', 'light', 'neon', 1, 'Neon night', '{"description":"city neon light, coloured reflections, cinematic night mood","preset":"light-neon"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('light@blue-hour/v1', 'light', 'blue-hour', 1, 'Blue hour', '{"description":"cool blue-hour dusk light with warm practical lights in the background","preset":"light-blue-hour"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('light@hard-noon/v1', 'light', 'hard-noon', 1, 'Hard noon sun', '{"description":"bright midday sun, hard graphic shadows, high contrast","preset":"light-hard-noon"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@city-street/v1', 'location', 'city-street', 1, 'City street', '{"description":"on a busy city sidewalk with shopfronts","preset":"loc-city-street"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@cafe/v1', 'location', 'cafe', 1, 'Café', '{"description":"at a small corner café table by the window","preset":"loc-cafe"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@apartment/v1', 'location', 'apartment', 1, 'Apartment', '{"description":"in a minimal, lived-in apartment with plants and books","preset":"loc-apartment"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@studio-wall/v1', 'location', 'studio-wall', 1, 'Coloured wall', '{"description":"against a single bold painted wall","preset":"loc-studio-wall"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@beach/v1', 'location', 'beach', 1, 'Beach', '{"description":"on a quiet beach with soft sand and sea in the background","preset":"loc-beach"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@park/v1', 'location', 'park', 1, 'Park', '{"description":"in a leafy city park on a path","preset":"loc-park"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@rooftop/v1', 'location', 'rooftop', 1, 'Rooftop', '{"description":"on a rooftop with the city skyline behind","preset":"loc-rooftop"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@subway/v1', 'location', 'subway', 1, 'Subway', '{"description":"on a subway platform, train lights blurred","preset":"loc-subway"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@market/v1', 'location', 'market', 1, 'Market', '{"description":"walking through an outdoor flower or food market","preset":"loc-market"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@gallery/v1', 'location', 'gallery', 1, 'Gallery', '{"description":"in a white-walled art gallery with large artworks","preset":"loc-gallery"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('location@home-city/v1', 'location', 'home-city', 1, 'Home city landmark', '{"description":"at a recognisable spot in {home_city}","preset":"loc-home-city"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('pose@walk/v1', 'pose', 'walk', 1, 'Walking', '{"description":"walking toward the camera mid-stride, natural movement","preset":"pose-walk"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('pose@stand/v1', 'pose', 'stand', 1, 'Standing relaxed', '{"description":"standing relaxed, weight on one leg, hands in pockets","preset":"pose-stand"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('pose@sit/v1', 'pose', 'sit', 1, 'Sitting', '{"description":"sitting casually, legs crossed, outfit still fully visible","preset":"pose-sit"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('pose@lean/v1', 'pose', 'lean', 1, 'Leaning', '{"description":"leaning against a wall, looking off to the side","preset":"pose-lean"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('pose@look-back/v1', 'pose', 'look-back', 1, 'Looking back', '{"description":"looking back over the shoulder toward the camera","preset":"pose-look-back"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('pose@laugh/v1', 'pose', 'laugh', 1, 'Candid laugh', '{"description":"caught mid-laugh, candid, not posed","preset":"pose-laugh"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('pose@hobby/v1', 'pose', 'hobby', 1, 'Doing their hobby', '{"description":"absorbed in {hobby}, not looking at the camera","preset":"pose-hobby"}'::jsonb, null, array[]::text[], null, null, 'Persona'),
  ('pose@adjust/v1', 'pose', 'adjust', 1, 'Adjusting outfit', '{"description":"adjusting a jacket collar or sleeve, hands near the clothes","preset":"pose-adjust"}'::jsonb, null, array[]::text[], null, null, 'Persona')
on conflict (address) do update set title = excluded.title, data = excluded.data, tags = excluded.tags, preview_url = excluded.preview_url;
-- STARTERS END

-- Check: should show the number of starter blocks per type.
select type, count(*) as blocks from public.blocks where author is null group by type order by type;
