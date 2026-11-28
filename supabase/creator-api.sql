-- Persona: connect AI tools (Custom GPTs, Claude, MCP apps) with personal API keys.
-- Paste this whole file into the Supabase SQL editor and press Run. Safe to run more than once.
-- It also includes the "create characters" setup, so you don't need to run create-characters.sql separately.
--
-- Security: API keys are random 48-character secrets. Only a SHA-256 fingerprint is stored, never the key.
-- The website calls these functions with the public key; each function checks the API key itself
-- and only ever acts for that key's owner, within the same rules as the Studio (owned characters, upload allowance).

-- =====================================================================================
-- Part 1. Characters made by creators (same as create-characters.sql)
-- =====================================================================================
alter table public.creators add column if not exists characters text[] not null default '{}';

create table if not exists public.characters (
  slug         text primary key
               check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 44
                      and slug not in ('lil-miquela', 'imma', 'aitana-lopez', 'nova-reyes')),
  name         text not null check (length(btrim(name)) between 1 and 60),
  handle       text check (handle is null or length(handle) <= 41),
  bio          text check (bio is null or length(bio) <= 600),
  avatar_url   text,
  avatar_path  text,
  creator_name text,
  owner        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
alter table public.characters enable row level security;

drop policy if exists "characters are public" on public.characters;
create policy "characters are public" on public.characters for select using (true);

drop policy if exists "creators create own characters" on public.characters;
create policy "creators create own characters" on public.characters for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "owners edit characters" on public.characters;
create policy "owners edit characters" on public.characters for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "owners delete characters" on public.characters;
create policy "owners delete characters" on public.characters for delete to authenticated
  using (owner = auth.uid());

create or replace function public.link_character_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.creators (id, name) values (new.owner, new.creator_name) on conflict (id) do nothing;
    update public.creators set characters = array_append(characters, new.slug)
      where id = new.owner and not (new.slug = any(characters));
    return new;
  else
    update public.creators set characters = array_remove(characters, old.slug) where id = old.owner;
    delete from public.images where character_slug = old.slug;
    return old;
  end if;
end $$;

drop trigger if exists characters_link_owner on public.characters;
create trigger characters_link_owner after insert or delete on public.characters
  for each row execute function public.link_character_owner();

grant usage on schema public to anon, authenticated;
grant select on public.characters to anon, authenticated;
grant insert, update, delete on public.characters to authenticated;
grant select on public.images, public.creators to anon, authenticated;
grant insert, update, delete on public.images to authenticated;

-- =====================================================================================
-- Part 2. API keys
-- =====================================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label        text not null default 'AI tool' check (length(label) between 1 and 60),
  prefix       text not null,                 -- first characters of the key, shown in Studio so you can tell keys apart
  key_hash     text not null unique,          -- SHA-256 of the key; the key itself is never stored
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
alter table public.api_keys enable row level security;
drop policy if exists "owners see own keys" on public.api_keys;
create policy "owners see own keys" on public.api_keys for select to authenticated using (owner = auth.uid());
revoke all on public.api_keys from anon, authenticated;
grant select (id, label, prefix, created_at, last_used_at, revoked_at) on public.api_keys to authenticated;

-- Short-lived, single-use permission to upload one file to storage under api/<ticket>/...
create table if not exists public.api_upload_tickets (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,
  character_slug text not null,
  purpose    text not null default 'image' check (purpose in ('image', 'avatar')),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at    timestamptz
);
alter table public.api_upload_tickets enable row level security;
revoke all on public.api_upload_tickets from anon, authenticated;

-- Signed-in creators make a key in Studio. Returns the key once; it can't be shown again.
create or replace function public.create_api_key(p_label text default 'AI tool') returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '28000'; end if;
  if (select count(*) from api_keys where owner = auth.uid() and revoked_at is null) >= 10 then
    raise exception 'You already have 10 keys. Remove one first.' using errcode = '54000';
  end if;
  k := 'psn_' || encode(gen_random_bytes(24), 'hex');
  insert into api_keys (owner, label, prefix, key_hash)
    values (auth.uid(), coalesce(nullif(left(btrim(p_label), 60), ''), 'AI tool'), left(k, 10), encode(digest(k, 'sha256'), 'hex'));
  insert into creators (id, name) values (auth.uid(), null) on conflict (id) do nothing;
  return k;
end $$;

create or replace function public.revoke_api_key(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update api_keys set revoked_at = now() where id = p_id and owner = auth.uid() and revoked_at is null;
$$;

-- Internal: which account does this key belong to? (not callable from the website)
create or replace function public.api_key_owner(p_key text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid;
begin
  if p_key is null or p_key !~ '^psn_[0-9a-f]{48}$' then raise exception 'Invalid API key.' using errcode = '28000'; end if;
  update api_keys set last_used_at = now()
    where key_hash = encode(digest(p_key, 'sha256'), 'hex') and revoked_at is null
    returning owner into uid;
  if uid is null then raise exception 'Invalid API key.' using errcode = '28000'; end if;
  return uid;
end $$;

create or replace function public.api_owns(uid uuid, slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from creators where id = uid and slug = any(characters));
$$;

-- =====================================================================================
-- Part 3. What an AI tool can do with a key
-- =====================================================================================

-- Who am I, my characters and my upload allowance.
create or replace function public.api_me(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key);
begin
  return (select jsonb_build_object(
    'name', c.name,
    'points', c.points,
    'uploads_used', uploads_used(uid),
    'uploads_allowed', upload_allowance(uid),
    'uploads_left', greatest(0, upload_allowance(uid) - uploads_used(uid)),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', ch.slug, 'name', ch.name, 'handle', ch.handle, 'bio', ch.bio, 'avatar_url', ch.avatar_url,
        'images', (select count(*) from images i where i.character_slug = ch.slug and i.url is not null),
        'live_images', (select count(*) from images i where i.character_slug = ch.slug and i.url is not null and i.live))
        order by ch.created_at)
      from characters ch where ch.slug = any(c.characters)), '[]'::jsonb))
    from creators c where c.id = uid);
end $$;

-- Create a character owned by the key's account.
create or replace function public.api_create_character(p_key text, p_name text, p_handle text default null, p_bio text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key); nm text := left(btrim(coalesce(p_name, '')), 60);
  base text; s text; n int := 2; h text; r characters;
begin
  if nm = '' then raise exception 'Give the character a name.' using errcode = '22023'; end if;
  if (select count(*) from characters where owner = uid) >= 50 then
    raise exception 'This account already has 50 characters.' using errcode = '54000';
  end if;
  base := left(trim(both '-' from regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g')), 40);
  if base = '' then base := 'character'; end if;
  s := base;
  while s in ('lil-miquela', 'imma', 'aitana-lopez', 'nova-reyes') or exists (select 1 from characters where slug = s) loop
    s := base || '-' || n; n := n + 1;
  end loop;
  h := nullif(btrim(coalesce(p_handle, '')), '');
  h := '@' || left(regexp_replace(coalesce(h, replace(s, '-', '')), '^@+', ''), 40);
  insert into characters (slug, name, handle, bio, creator_name, owner)
    values (s, nm, h, nullif(left(btrim(coalesce(p_bio, '')), 600), ''), (select name from creators where id = uid), uid)
    returning * into r;
  return jsonb_build_object('slug', r.slug, 'name', r.name, 'handle', r.handle, 'bio', r.bio, 'avatar_url', r.avatar_url);
end $$;

-- Step 1 of adding an image: check the rules and get a one-time upload ticket.
create or replace function public.api_upload_ticket(p_key text, p_slug text, p_purpose text default 'image') returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key); t uuid;
begin
  if not api_owns(uid, p_slug) then raise exception 'You don''t own a character called "%".', p_slug using errcode = '42501'; end if;
  if p_purpose = 'image' and uploads_used(uid) >= upload_allowance(uid) then
    raise exception 'No uploads left (% of % used). Every 10 points unlocks one more.', uploads_used(uid), upload_allowance(uid) using errcode = '54000';
  end if;
  if (select count(*) from api_upload_tickets where owner = uid and expires_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many uploads in the last hour. Try again later.' using errcode = '54000';
  end if;
  insert into api_upload_tickets (owner, character_slug, purpose) values (uid, p_slug, coalesce(p_purpose, 'image')) returning id into t;
  return t;
end $$;

-- Storage rule: a valid, unused ticket allows exactly the upload under api/<ticket>/.
create or replace function public.api_ticket_open(p_ticket text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_ticket ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then exists (
    select 1 from api_upload_tickets where id = p_ticket::uuid and used_at is null and expires_at > now()) else false end;
$$;

-- Step 2: after the file is uploaded, record it (as a new image, or as the character's profile photo).
create or replace function public.api_finish_upload(p_key text, p_ticket uuid, p_url text, p_live boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key); t api_upload_tickets; path text; img_id text;
begin
  select * into t from api_upload_tickets where id = p_ticket and owner = uid and used_at is null for update;
  if t.id is null then raise exception 'Upload ticket not found or already used.' using errcode = '22023'; end if;
  path := 'api/' || t.id || '/';
  if position('/storage/v1/object/public/character-images/' || path in coalesce(p_url, '')) = 0 then
    raise exception 'Image address doesn''t match the upload ticket.' using errcode = '22023';
  end if;
  path := substr(p_url, position('/character-images/' in p_url) + length('/character-images/'));
  update api_upload_tickets set used_at = now() where id = t.id;
  if t.purpose = 'avatar' then
    update characters set avatar_url = p_url, avatar_path = path where slug = t.character_slug and owner = uid;
    return jsonb_build_object('character', t.character_slug, 'avatar_url', p_url);
  end if;
  if uploads_used(uid) >= upload_allowance(uid) then
    raise exception 'No uploads left.' using errcode = '54000';
  end if;
  img_id := 'up-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-api' || substr(md5(t.id::text), 1, 6);
  insert into images (id, character_slug, url, path, live, owner) values (img_id, t.character_slug, p_url, path, coalesce(p_live, false), uid);
  return jsonb_build_object('id', img_id, 'character', t.character_slug, 'url', p_url, 'live', coalesce(p_live, false),
    'uploads_left', greatest(0, upload_allowance(uid) - uploads_used(uid)));
end $$;

-- List a character's uploaded images.
create or replace function public.api_list_images(p_key text, p_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key);
begin
  if not api_owns(uid, p_slug) then raise exception 'You don''t own a character called "%".', p_slug using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'url', url, 'live', live, 'created_at', created_at) order by created_at)
    from images where character_slug = p_slug and url is not null), '[]'::jsonb);
end $$;

-- Publish or hide an image.
create or replace function public.api_set_live(p_key text, p_image_id text, p_live boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key); s text;
begin
  select character_slug into s from images where id = p_image_id;
  if s is null or not api_owns(uid, s) then raise exception 'Image not found.' using errcode = '42501'; end if;
  update images set live = coalesce(p_live, false) where id = p_image_id;
  return jsonb_build_object('id', p_image_id, 'live', coalesce(p_live, false));
end $$;

-- Storage: let the website's server upload with a ticket (folder api/<ticket>/).
drop policy if exists "api ticket uploads" on storage.objects;
create policy "api ticket uploads" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'character-images' and (storage.foldername(name))[1] = 'api'
    and public.api_ticket_open((storage.foldername(name))[2]));

-- Who may call what. Internal helpers stay private.
revoke execute on function public.api_key_owner(text), public.api_owns(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_api_key(text), public.revoke_api_key(uuid) from public, anon;
grant execute on function public.create_api_key(text), public.revoke_api_key(uuid) to authenticated;
grant execute on function public.api_me(text), public.api_create_character(text, text, text, text),
  public.api_upload_ticket(text, text, text), public.api_finish_upload(text, uuid, text, boolean),
  public.api_list_images(text, text), public.api_set_live(text, text, boolean), public.api_ticket_open(text) to anon, authenticated;

-- Check: should list the new functions.
select routine_name from information_schema.routines where routine_schema = 'public' and routine_name like 'api_%' order by 1;
