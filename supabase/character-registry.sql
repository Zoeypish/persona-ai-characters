-- Persona: character registry, camera presets and drift guard.
-- Paste this whole file into the Supabase SQL editor and press Run. Safe to run more than once.
-- Needs the earlier setup (creator-api.sql), which is already live.
--
-- What it adds:
--   1. character_versions: a versioned spec (identity, traits, reference images) per character. Saves never overwrite;
--      each save is a new version, so you can always go back.
--   2. New columns on images: the shot recipe (camera/lighting/location/pose presets), which spec version it was made with,
--      a picture fingerprint for spotting near-duplicates, the creator's "same face?" answer and the AI tool's self-check.
--   3. Functions the Custom GPT / API use with a creator's API key.

-- =====================================================================================
-- 1. Character registry (versioned specs)
-- =====================================================================================
create table if not exists public.character_versions (
  character_slug text not null,
  version        integer not null check (version > 0),
  spec           jsonb not null check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) < 40000),
  note           text check (note is null or length(note) <= 200),
  owner          uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (character_slug, version)
);
alter table public.character_versions enable row level security;

-- Only the character's owner can read its spec. Nobody can edit or delete a saved version (history stays honest).
drop policy if exists "owners read specs" on public.character_versions;
create policy "owners read specs" on public.character_versions for select to authenticated
  using (public.owns_character(character_slug));
revoke all on public.character_versions from anon, authenticated;
grant select on public.character_versions to authenticated;

-- Internal: save a new version for account uid.
create or replace function public.registry_save_for(uid uuid, p_slug text, p_spec jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v int; s jsonb;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'The spec must be a JSON object.' using errcode = '22023';
  end if;
  if not exists (select 1 from creators where id = uid and p_slug = any(characters)) then
    raise exception 'You don''t own a character called "%".', p_slug using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('registry:' || p_slug));
  select coalesce(max(version), 0) + 1 into v from character_versions where character_slug = p_slug;
  if v > 500 then raise exception 'This character already has 500 versions.' using errcode = '54000'; end if;
  s := jsonb_set(p_spec, '{id}', to_jsonb(p_slug));            -- the stable ID always matches the character
  insert into character_versions (character_slug, version, spec, note, owner)
    values (p_slug, v, s, nullif(left(btrim(coalesce(p_note, '')), 200), ''), uid);
  return jsonb_build_object('id', p_slug, 'version', v, 'note', nullif(left(btrim(coalesce(p_note, '')), 200), ''), 'created_at', now());
end $$;

-- Studio (signed in): save a new version.
create or replace function public.registry_save(p_slug text, p_spec jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '28000'; end if;
  return registry_save_for(auth.uid(), p_slug, p_spec, p_note);
end $$;

-- =====================================================================================
-- 2. Image details for the drift guard
-- =====================================================================================
alter table public.images add column if not exists recipe       jsonb;    -- {camera, lighting, location, pose} preset ids
alter table public.images add column if not exists spec_version integer;  -- registry version the image was made with
alter table public.images add column if not exists phash        text;     -- 64-bit picture fingerprint (16 hex), made in Studio
alter table public.images add column if not exists on_model     text;     -- creator's answer: 'yes' same face, 'no' off-model
alter table public.images add column if not exists ai_check     jsonb;    -- AI tool's self-check: {face, hair, signature: 1-5, notes}
do $$ begin
  alter table public.images add constraint images_on_model_check check (on_model is null or on_model in ('yes', 'no'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.images add constraint images_phash_check check (phash is null or phash ~ '^[0-9a-f]{16}$');
exception when duplicate_object then null; end $$;
-- (Studio already may update its own images; the existing owner-only rules cover these columns too.)

-- =====================================================================================
-- 3. What an AI tool can do with an API key
-- =====================================================================================

-- Read the latest spec (or a given version) and the version history.
create or replace function public.api_registry_get(p_key text, p_slug text, p_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key); r character_versions;
begin
  if not api_owns(uid, p_slug) then raise exception 'You don''t own a character called "%".', p_slug using errcode = '42501'; end if;
  select * into r from character_versions where character_slug = p_slug
    and (p_version is null or version = p_version) order by version desc limit 1;
  return jsonb_build_object(
    'id', p_slug,
    'version', r.version,
    'spec', r.spec,
    'note', r.note,
    'created_at', r.created_at,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'note', note, 'created_at', created_at) order by version desc)
      from character_versions where character_slug = p_slug), '[]'::jsonb));
end $$;

-- Save a new version.
create or replace function public.api_registry_save(p_key text, p_slug text, p_spec jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return registry_save_for(api_key_owner(p_key), p_slug, p_spec, p_note);
end $$;

-- Recent images with their recipe, fingerprint and checks, newest first (for the drift guard).
create or replace function public.api_recent_images(p_key text, p_slug text, p_limit int default 40)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key);
begin
  if not api_owns(uid, p_slug) then raise exception 'You don''t own a character called "%".', p_slug using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', id, 'url', url, 'live', live, 'recipe', recipe, 'spec_version', spec_version,
      'phash', phash, 'on_model', on_model, 'ai_check', ai_check, 'created_at', created_at) as x
    from images where character_slug = p_slug and url is not null
    order by created_at desc limit least(greatest(coalesce(p_limit, 40), 1), 100)) t), '[]'::jsonb);
end $$;

-- Record how an image was made (recipe, spec version) and the AI tool's self-check.
create or replace function public.api_tag_image(p_key text, p_image_id text, p_recipe jsonb default null,
  p_spec_version int default null, p_ai_check jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := api_key_owner(p_key); s text;
begin
  select character_slug into s from images where id = p_image_id;
  if s is null or not api_owns(uid, s) then raise exception 'Image not found.' using errcode = '42501'; end if;
  if p_recipe is not null and (jsonb_typeof(p_recipe) <> 'object' or pg_column_size(p_recipe) > 2000) then
    raise exception 'recipe must be a small JSON object.' using errcode = '22023'; end if;
  if p_ai_check is not null and (jsonb_typeof(p_ai_check) <> 'object' or pg_column_size(p_ai_check) > 2000) then
    raise exception 'self_check must be a small JSON object.' using errcode = '22023'; end if;
  update images set
    recipe = coalesce(p_recipe, recipe),
    spec_version = coalesce(p_spec_version, spec_version),
    ai_check = coalesce(p_ai_check, ai_check)
  where id = p_image_id;
  return jsonb_build_object('id', p_image_id, 'recipe', p_recipe, 'spec_version', p_spec_version, 'ai_check', p_ai_check);
end $$;

-- Who may call what. The internal helper stays private.
revoke execute on function public.registry_save_for(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.registry_save(text, jsonb, text) from public, anon;
grant execute on function public.registry_save(text, jsonb, text) to authenticated;
grant execute on function public.api_registry_get(text, text, int), public.api_registry_save(text, text, jsonb, text),
  public.api_recent_images(text, text, int), public.api_tag_image(text, text, jsonb, int, jsonb) to anon, authenticated;

-- Check: should list character_versions and the four new api_ functions.
select 'table' as kind, table_name as name from information_schema.tables where table_schema = 'public' and table_name = 'character_versions'
union all
select 'function', routine_name from information_schema.routines where routine_schema = 'public'
  and routine_name in ('registry_save', 'api_registry_get', 'api_registry_save', 'api_recent_images', 'api_tag_image')
order by 1, 2;
