-- Persona: saves and follows in accounts, plus safety and rights.
-- Paste this whole file into Supabase > SQL Editor and press Run. Safe to run more than once.
-- Needs the earlier setup files (schema.sql, character-ownership.sql, create-characters.sql) to have been run.

------------------------------------------------------------------------------------------
-- 1. Saves and follows, stored per account. Each person only sees and changes their own.
------------------------------------------------------------------------------------------
create table if not exists public.saves (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pin_id     text not null,
  pin        jsonb not null default '{}'::jsonb,   -- what the Saved page needs to show it (image, character, credit)
  created_at timestamptz not null default now(),
  primary key (user_id, pin_id)
);
create table if not exists public.follows (
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  character_slug text not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, character_slug)
);
alter table public.saves enable row level security;
alter table public.follows enable row level security;

drop policy if exists "own saves" on public.saves;
create policy "own saves" on public.saves for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own follows" on public.follows;
create policy "own follows" on public.follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

------------------------------------------------------------------------------------------
-- 2. Site admins (people who review reports). Add yourself at the bottom of this file.
------------------------------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins see admins" on public.admins;
create policy "admins see admins" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

------------------------------------------------------------------------------------------
-- 3. Images: rights confirmation and review status.
--    moderation: 'ok' (shown), 'review' (hidden until an admin decides), 'removed' (taken down).
------------------------------------------------------------------------------------------
alter table public.images add column if not exists rights_confirmed    boolean not null default false;
alter table public.images add column if not exists rights_confirmed_at timestamptz;
alter table public.images add column if not exists rights_note         text;
alter table public.images add column if not exists moderation          text not null default 'ok';
alter table public.images add column if not exists moderated_at        timestamptz;
alter table public.images drop constraint if exists images_moderation_check;
alter table public.images add constraint images_moderation_check check (moderation in ('ok', 'review', 'removed'));

-- Origin record (provenance) for each image: which AI tool or model made it, and the prompt/recipe or source.
-- Who made it (owner) and when (created_at) are already stored.
alter table public.images add column if not exists origin_tool   text;
alter table public.images add column if not exists origin_recipe text;
alter table public.images add column if not exists origin_source text;
alter table public.images drop constraint if exists images_origin_len;
alter table public.images add constraint images_origin_len check (
  coalesce(length(origin_tool), 0) <= 80 and coalesce(length(origin_recipe), 0) <= 4000 and coalesce(length(origin_source), 0) <= 500);

-- Characters: the creator confirms it's not a real person used without consent.
alter table public.characters add column if not exists rights_confirmed    boolean not null default false;
alter table public.characters add column if not exists rights_confirmed_at timestamptz;

-- Uploads from the website must carry the rights confirmation (built-in image switches have no url).
drop policy if exists "creators insert within allowance" on public.images;
create policy "creators insert within allowance" on public.images for insert to authenticated
  with check (public.owns_character(character_slug)
    and (url is null or (rights_confirmed and public.uploads_used(auth.uid()) < public.upload_allowance(auth.uid()))));

-- New characters made on the website must carry the confirmation too.
drop policy if exists "creators create own characters" on public.characters;
create policy "creators create own characters" on public.characters for insert to authenticated
  with check (owner = auth.uid() and rights_confirmed);

-- Owners and admins can see hidden or under-review images; everyone sees live ones
-- (the site itself hides anything not 'ok').
drop policy if exists "read live or owner" on public.images;
create policy "read live or owner" on public.images for select
  using (live or public.owns_character(character_slug) or public.is_admin());

-- Guard: creators can't clear a review or a takedown themselves, and rights fields are stamped by the server.
-- (Runs as the caller, so it can tell the website's roles apart from Persona's own server functions.)
create or replace function public.images_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- Uploads through Connect AI: the creator agreed to the upload rules when making their API key.
    if new.url is not null and new.path like 'api/%' then
      new.rights_confirmed := true;
      new.rights_note := coalesce(new.rights_note, 'Confirmed when creating the API key');
      new.origin_tool := coalesce(nullif(btrim(new.origin_tool), ''), 'AI tool via Connect AI');
    end if;
    if new.rights_confirmed then new.rights_confirmed_at := now(); end if;
    if current_user in ('anon', 'authenticated') and not public.is_admin() then new.moderation := 'ok'; new.moderated_at := null; end if;
  else
    new.rights_confirmed := old.rights_confirmed; new.rights_confirmed_at := old.rights_confirmed_at; new.rights_note := old.rights_note;
    if current_user in ('anon', 'authenticated') and not public.is_admin() then
      new.moderation := old.moderation; new.moderated_at := old.moderated_at;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists images_guard on public.images;
create trigger images_guard before insert or update on public.images for each row execute function public.images_guard();

create or replace function public.characters_rights_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  -- Characters made through Connect AI: the creator agreed to the rules when making their API key.
  if current_user not in ('anon', 'authenticated') then new.rights_confirmed := true; end if;
  if new.rights_confirmed then new.rights_confirmed_at := now(); end if;
  return new;
end $$;
drop trigger if exists characters_rights_stamp on public.characters;
create trigger characters_rights_stamp before insert on public.characters for each row execute function public.characters_rights_stamp();

------------------------------------------------------------------------------------------
-- 4. Reports and takedown requests.
--    kind 'report'  : the Report button on an image (signed-in people, one per person per image).
--    kind 'takedown': the takedown request form (anyone, with contact details).
--    3 reports from different people hide the image until an admin reviews it.
------------------------------------------------------------------------------------------
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null default 'report' check (kind in ('report', 'takedown')),
  image_id       text,
  character_slug text,
  image_url      text,
  page_url       text,
  reason         text not null check (reason in ('real_person', 'copyright', 'sexual', 'minor', 'hate', 'violence', 'spam', 'other', 'appeal')),
  details        text check (details is null or length(details) <= 2000),
  reporter       uuid default auth.uid() references auth.users(id) on delete set null,
  contact_name   text check (contact_name is null or length(contact_name) <= 120),
  contact_email  text check (contact_email is null or length(contact_email) <= 200),
  is_rights_owner boolean not null default false,
  status         text not null default 'open' check (status in ('open', 'kept', 'removed')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid references auth.users(id) on delete set null
);
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in ('real_person', 'copyright', 'sexual', 'minor', 'hate', 'violence', 'spam', 'other', 'appeal'));
create unique index if not exists reports_one_per_person on public.reports (image_id, reporter) where kind = 'report' and reporter is not null;
alter table public.reports enable row level security;

drop policy if exists "signed-in people report" on public.reports;
create policy "signed-in people report" on public.reports for insert to authenticated
  with check (status = 'open' and (reporter = auth.uid()) and (kind = 'report' or kind = 'takedown'));
drop policy if exists "anyone requests takedown" on public.reports;
create policy "anyone requests takedown" on public.reports for insert to anon
  with check (status = 'open' and kind = 'takedown' and reporter is null and contact_email is not null);
drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports" on public.reports for select to authenticated using (public.is_admin());
drop policy if exists "reporters see own reports" on public.reports;
create policy "reporters see own reports" on public.reports for select to authenticated using (reporter = auth.uid());

-- After each report: if 3 different people reported this image, hide it for review.
create or replace function public.reports_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare n int; slug text;
begin
  if new.image_id is null then return new; end if;
  select count(distinct coalesce(reporter::text, id::text)) into n
    from reports where image_id = new.image_id and status = 'open' and kind = 'report';
  if n >= 3 then
    slug := coalesce(new.character_slug, (select character_slug from images where id = new.image_id));
    if slug is null then return new; end if;
    -- Built-in images may have no row yet: add one that keeps them live but under review.
    insert into images (id, character_slug, live, moderation, moderated_at, owner)
      values (new.image_id, slug, true, 'review', now(), null)
      on conflict (id) do update set moderation = 'review', moderated_at = now() where images.moderation = 'ok';
  end if;
  return new;
end $$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports for each row execute function public.reports_after_insert();

-- Admin decision on an image: 'keep' (show again, close its reports), 'remove' (take down), 'review' (hide now).
create or replace function public.moderate_image(p_image_id text, p_action text, p_slug text default null) returns text
language plpgsql security definer set search_path = public as $$
declare st text; rs text;
begin
  if not public.is_admin() then raise exception 'Only Persona admins can do this.' using errcode = '42501'; end if;
  st := case p_action when 'keep' then 'ok' when 'remove' then 'removed' when 'review' then 'review' end;
  if st is null then raise exception 'Unknown action %', p_action using errcode = '22023'; end if;
  update images set moderation = st, moderated_at = now() where id = p_image_id;
  if not found then
    -- A built-in image with no row yet.
    p_slug := coalesce(p_slug, (select character_slug from reports where image_id = p_image_id and character_slug is not null limit 1));
    if p_slug is null then raise exception 'Image not found.' using errcode = '22023'; end if;
    insert into images (id, character_slug, live, moderation, moderated_at, owner) values (p_image_id, p_slug, true, st, now(), null);
  end if;
  rs := case p_action when 'keep' then 'kept' when 'remove' then 'removed' end;
  if rs is not null then
    update reports set status = rs, resolved_at = now(), resolved_by = auth.uid() where image_id = p_image_id and status = 'open';
  end if;
  return st;
end $$;

-- Close a report that isn't about a specific image (e.g. a takedown request for a whole character).
create or replace function public.resolve_report(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Persona admins can do this.' using errcode = '42501'; end if;
  if p_status not in ('kept', 'removed', 'open') then raise exception 'Unknown status' using errcode = '22023'; end if;
  update reports set status = p_status, resolved_at = case when p_status = 'open' then null else now() end,
    resolved_by = case when p_status = 'open' then null else auth.uid() end where id = p_id;
end $$;

------------------------------------------------------------------------------------------
-- 5. Permissions for the website's roles (the rules above still decide which rows).
------------------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.saves, public.follows to authenticated;
grant select on public.admins to authenticated;
grant insert on public.reports to anon, authenticated;
grant select on public.reports to authenticated;
grant select on public.images, public.creators, public.characters to anon, authenticated;
grant insert, update, delete on public.images to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.moderate_image(text, text, text), public.resolve_report(uuid, text) to authenticated;
revoke execute on function public.moderate_image(text, text, text), public.resolve_report(uuid, text) from anon;

------------------------------------------------------------------------------------------
-- 6. Make yourself an admin (so you get the Review page). Use the email you sign in with:
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
------------------------------------------------------------------------------------------

-- Check: should list saves, follows, admins, reports.
select table_name from information_schema.tables
  where table_schema = 'public' and table_name in ('saves', 'follows', 'admins', 'reports') order by 1;
